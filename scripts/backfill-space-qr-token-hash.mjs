/**
 * 空间码 token 摘要 / 密文回填脚本
 *
 * ⚠️ 适用范围：`space_qr_codes.token` 明文列**删除之前**的环境。
 * 明文列删除（`20260928093000_drop_space_qr_token_plaintext`）之后就没有可回填的
 * 来源了，脚本会直接报错退出——那时它已完成历史使命。
 * 每个环境按「加列 → 回填 → 删列」顺序走一遍即可，删列后本脚本不再需要。
 *
 * ── 背景 ──────────────────────────────────────────────────────────────────
 *
 * 迁移 `20260927093000_add_space_qr_token_hash` 给 `space_qr_codes` 加了
 * `token_hash` / `token_ciphertext` / `token_prefix` 三列（均可空，只做加法）。
 * 迁移本身不回填数据 —— 回填要加密，需要密钥，属于运行期配置，不该写死在 SQL 里。
 *
 * 解析侧是「双读」：`OR [按 token_hash 命中, 明文命中且该行未回填]`。
 * 所以**回填完成后**，明文分支自然失效：整库泄漏拿到的明文 token 也匹配不上，
 * 安全性当场生效，而不必等删除 token 列（删除是不可逆操作，单独做）。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   # dry-run（默认，只统计不写库）
 *   pnpm space:qr:backfill
 *
 *   # 实际写库
 *   pnpm space:qr:backfill --apply
 *
 * ── 上线顺序 ──────────────────────────────────────────────────────────────
 *
 *   1. 部署迁移（三列已存在，解析侧双读，功能不受影响）
 *   2. 部署后端（写入侧同时写摘要 + 密文）
 *   3. 先显式配置 SPACE_QR_TOKEN_ENCRYPTION_KEY 再回填 —— 否则密文只能由
 *      JWT_SECRET 派生，JWT_SECRET 轮换后历史密文解不开
 *   4. dry-run 核对数量 → --apply
 *   5. 复跑一次 dry-run，确认待回填数为 0
 *   6. 真机验证：扫一张历史空间码仍能进呼叫服务 / 自助下单；
 *      商家端「预览 / 下载」仍能出图
 *
 * ── 安全保证 ──────────────────────────────────────────────────────────────
 *
 *   - 默认 dry-run，--apply 才写库；
 *   - 幂等：只处理 token_hash 为空 **或** token_ciphertext 为空的行，
 *     配好密钥后复跑会自动把密文补上，不会覆盖已有值；
 *   - 不改动 token 明文列，随时可回滚（回滚只需把解析侧改回按明文查）；
 *   - 逐行更新，单行失败只记 id 不中断整批。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isApply = process.argv.includes('--apply');

// ─── 环境变量 ──────────────────────────────────────────────────────────────

function loadEnvFile() {
  const envPath = resolve(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const matched = line.match(/^\s*([A-Z0-9_]+)\s*=\s*["']?(.+?)["']?\s*$/);
    if (!matched) continue;
    const [, key, value] = matched;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** 候选密钥中的主密钥：显式配置优先，否则由 JWT_SECRET 派生（与服务端口径一致） */
function resolvePrimaryKey() {
  const explicit = process.env.SPACE_QR_TOKEN_ENCRYPTION_KEY?.trim();
  if (explicit) {
    const key = Buffer.from(explicit, 'base64');
    if (key.length !== 32) {
      throw new Error('SPACE_QR_TOKEN_ENCRYPTION_KEY 必须为 32 字节 Base64 值');
    }
    return key;
  }

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret) {
    return createHash('sha256').update(`space-qr-token:${jwtSecret}`).digest();
  }

  return null;
}

/** 与服务端 space-qr-token-codec.utils.ts 的 encryptSpaceQrToken 同构 */
function encryptToken(token, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString('base64url'))
    .join('.');
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────

async function main() {
  loadEnvFile();

  if (!process.env.DATABASE_URL) {
    console.error('❌ 无法找到 DATABASE_URL 环境变量');
    process.exit(1);
  }

  const key = resolvePrimaryKey();

  // Prisma 7 的 datasource 不写 url，必须显式传驱动适配器
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { default: pg } = await import('pg');

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const stats = {
    total: 0,
    pendingHash: 0,
    pendingCiphertext: 0,
    updated: 0,
    failedIds: [],
  };

  try {
    stats.total = await prisma.spaceQrCode.count();

    const pending = await prisma.spaceQrCode.findMany({
      where: {
        OR: [{ tokenHash: null }, { tokenCiphertext: null }],
      },
      select: {
        id: true,
        token: true,
        tokenHash: true,
        tokenCiphertext: true,
        tokenPrefix: true,
      },
      orderBy: { id: 'asc' },
    });

    for (const row of pending) {
      if (row.tokenHash === null) stats.pendingHash += 1;
      if (row.tokenCiphertext === null) stats.pendingCiphertext += 1;
    }

    console.log('空间码 token 回填');
    console.log(`  模式：${isApply ? '--apply（写库）' : 'dry-run（不写库）'}`);
    console.log(
      `  加密密钥：${key ? '已就绪' : '❌ 缺失（SPACE_QR_TOKEN_ENCRYPTION_KEY 与 JWT_SECRET 均为空）'}`,
    );
    console.log(`  空间码总数：${stats.total}`);
    console.log(`  待回填摘要：${stats.pendingHash}`);
    console.log(`  待回填密文：${stats.pendingCiphertext}`);
    console.log('');

    if (pending.length === 0) {
      console.log('✅ 没有需要回填的空间码。');
      return;
    }

    if (!key) {
      console.error(
        '❌ 没有可用加密密钥，无法生成密文。\n' +
          '   请先配置 SPACE_QR_TOKEN_ENCRYPTION_KEY（32 字节 Base64）：\n' +
          "   node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\"\n" +
          '   再重跑本脚本。摘要回填不受影响，但缺少密文会让「删除 token 明文列」\n' +
          '   这一步无法进行。',
      );
      process.exit(1);
    }

    for (const row of pending) {
      const data = {};
      if (row.tokenHash === null) {
        data.tokenHash = createHash('sha256').update(row.token).digest('hex');
      }
      if (row.tokenPrefix === null) {
        data.tokenPrefix = row.token.slice(0, 8);
      }
      if (row.tokenCiphertext === null) {
        data.tokenCiphertext = encryptToken(row.token, key);
      }

      if (!isApply) {
        console.log(
          `  [dry-run] 空间码 #${row.id} → ${Object.keys(data).join(', ')}`,
        );
        continue;
      }

      try {
        await prisma.spaceQrCode.update({ where: { id: row.id }, data });
        stats.updated += 1;
      } catch (error) {
        stats.failedIds.push(row.id);
        console.error(`  ❌ 空间码 #${row.id} 回填失败：${error.message}`);
      }
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }

  console.log('');
  console.log('── 结果 ──────────────────────────────────────────────');
  console.log(`  实际更新：${stats.updated}`);
  console.log(
    `  失败：${stats.failedIds.length}${stats.failedIds.length ? ` (${stats.failedIds.join(', ')})` : ''}`,
  );

  if (stats.failedIds.length > 0) {
    process.exit(1);
  }

  if (!isApply) {
    console.log(
      '\n  dry-run 未写库。确认无误后执行：pnpm space:qr:backfill --apply',
    );
  }
}

main().catch((error) => {
  console.error(`❌ 回填失败：${error.message}`);
  process.exit(1);
});
