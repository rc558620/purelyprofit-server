/**
 * 历史餐饮门店 business_mode 回填脚本
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   # dry-run（默认，只打印待修改门店，不写库）
 *   pnpm store-business-mode:backfill
 *
 *   # 实际写库
 *   pnpm store-business-mode:backfill --apply
 *
 *   # 通过环境变量指定门店 ID 列表
 *   CATERING_STORE_IDS=101,102,103 pnpm store-business-mode:backfill
 *   CATERING_STORE_IDS=101,102,103 pnpm store-business-mode:backfill --apply
 *
 * ── 上线顺序 ──────────────────────────────────────────────────────────────
 *
 *   1. 部署数据库 migration（business_mode 字段已存在）
 *   2. 部署后端业态 API / guard（@RequireBusinessMode, StoreBusinessCapabilityService）
 *   3. 执行 dry-run：pnpm store-business-mode:backfill
 *   4. 核对输出的餐饮门店清单是否符合预期
 *   5. 执行 --apply：pnpm store-business-mode:backfill --apply
 *   6. 验证更新数量是否正确
 *   7. 使用餐饮历史门店账号验证：
 *      - /auth/profile
 *      - /auth/capability
 *      - 首页入口
 *      - 商家端扫码点餐
 *      - C 端旧二维码解析
 *   8. 使用非餐饮门店验证空间管理、营销商品上架
 *   9. 监控 403、扫码解析失败和菜单缓存异常
 *
 * ── 安全保证 ──────────────────────────────────────────────────────────────
 *
 *   - 默认 dry-run，不写库
 *   --apply 才写库
 *   - 仅更新 business_mode = general 的目标门店，不覆盖已是 catering 的门店
 *   - 重复执行幂等
 *   - 输出：输入总数 / 找到门店数 / 已是 catering 数 / 实际更新数 / 不存在门店 ID / 失败记录
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 参数解析 ──────────────────────────────────────────────────────────────

const isApply = process.argv.includes('--apply');

// ─── 读取门店 ID 清单 ─────────────────────────────────────────────────────

function loadCateringStoreIds() {
  // 优先从环境变量读取
  const envIds = process.env.CATERING_STORE_IDS;
  if (envIds && envIds.trim()) {
    return envIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  // 从 JSON 文件读取
  const jsonPath = resolve(__dirname, 'data', 'catering-store-ids.json');
  if (existsSync(jsonPath)) {
    const content = readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(content);
    if (Array.isArray(data.storeIds)) {
      return data.storeIds
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
    }
  }

  return [];
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────

async function main() {
  const storeIds = loadCateringStoreIds();

  if (storeIds.length === 0) {
    console.log('⚠️  未找到餐饮门店 ID 清单。');
    console.log('   请通过以下方式之一提供：');
    console.log('   1. 环境变量：CATERING_STORE_IDS=101,102,103');
    console.log('   2. JSON 文件：scripts/data/catering-store-ids.json');
    console.log('');
    process.exit(1);
  }

  // 读取数据库连接字符串
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // 尝试从 .env 读取
    const envPath = resolve(__dirname, '..', '.env');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      const match = envContent.match(/^DATABASE_URL=["']?(.+?)["']?\s*$/m);
      if (match) {
        process.env.DATABASE_URL = match[1];
      }
    }
  }

  if (!process.env.DATABASE_URL) {
    console.error('❌ 无法找到 DATABASE_URL 环境变量');
    process.exit(1);
  }

  // 动态导入 Prisma Client
  const { PrismaClient } = await import(
    '@prisma/client'
  );
  const prisma = new PrismaClient();

  const stats = {
    inputCount: storeIds.length,
    foundCount: 0,
    alreadyCateringCount: 0,
    updatedCount: 0,
    notFoundIds: [],
    failedIds: [],
  };

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  门店业态回填脚本');
    console.log(`  模式: ${isApply ? '⚡ APPLY（写库）' : '🔍 DRY-RUN（只读）'}`);
    console.log(`  输入门店数: ${storeIds.length}`);
    console.log(`  目标业态: catering`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    for (const storeId of storeIds) {
      try {
        const store = await prisma.store.findUnique({
          where: { id: storeId },
          select: { id: true, name: true, businessMode: true },
        });

        if (!store) {
          stats.notFoundIds.push(storeId);
          console.log(`  ❌ 门店 ${storeId} 不存在`);
          continue;
        }

        stats.foundCount++;

        if (store.businessMode === 'catering') {
          stats.alreadyCateringCount++;
          console.log(`  ✓ 门店 ${storeId} (${store.name}) 已是 catering，跳过`);
          continue;
        }

        if (store.businessMode === 'general') {
          if (isApply) {
            await prisma.store.update({
              where: { id: storeId },
              data: { businessMode: 'catering' },
            });
            stats.updatedCount++;
            console.log(`  ✅ 门店 ${storeId} (${store.name}) 已更新为 catering`);
          } else {
            stats.updatedCount++;
            console.log(`  📝 门店 ${storeId} (${store.name}) 待更新为 catering`);
          }
        }
      } catch (error) {
        stats.failedIds.push(storeId);
        console.error(`  💥 门店 ${storeId} 处理失败: ${error.message}`);
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  回填结果摘要');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  输入总数:        ${stats.inputCount}`);
    console.log(`  找到门店数:      ${stats.foundCount}`);
    console.log(`  已是 catering:   ${stats.alreadyCateringCount}`);
    console.log(`  ${isApply ? '实际更新' : '待更新'}数:    ${stats.updatedCount}`);
    console.log(`  不存在门店 ID:   ${stats.notFoundIds.length > 0 ? stats.notFoundIds.join(', ') : '无'}`);
    console.log(`  失败记录:        ${stats.failedIds.length > 0 ? stats.failedIds.join(', ') : '无'}`);
    console.log('');
    if (!isApply && stats.updatedCount > 0) {
      console.log('  ⚠️  以上为 dry-run 结果，未写库。');
      console.log('      确认无误后执行 --apply 写入数据库。');
    }
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});
