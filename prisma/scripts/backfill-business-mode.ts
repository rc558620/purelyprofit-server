/**
 * 历史门店业态回填脚本
 *
 * 用途：将已注册但 businessMode 仍为默认值 general 的餐饮门店修正为 catering。
 *
 * 背景：
 *   迁移 20260724120000_add_store_business_mode 为所有历史门店设置 businessMode = general。
 *   门店注册时的 storeType 存储在 Redis 缓存中（stores:profile:{storeId}），
 *   无法在 SQL 迁移中直接回填。
 *
 * 执行方式：
 *   npx ts-node prisma/scripts/backfill-business-mode.ts
 *
 * 安全措施：
 *   - 默认 dry-run 模式，仅输出将要修改的门店列表，不写入数据库
 *   - 添加 --apply 参数后才真正执行更新
 *   - 输出完整的更新日志和汇总
 */

import { PrismaClient, StoreBusinessMode } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 0,
});

const STORE_PROFILE_CACHE_KEY_PREFIX = 'stores:profile:';

interface StoreBackfillCandidate {
  id: number;
  name: string;
  currentMode: string;
  cachedStoreType: string | null;
  targetMode: StoreBusinessMode;
}

async function getCachedStoreType(storeId: number): Promise<string | null> {
  try {
    const key = `${STORE_PROFILE_CACHE_KEY_PREFIX}${storeId}`;
    const raw = await redis.get(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    // 缓存结构可能是 { storeType: "餐饮" } 或嵌套在 store 字段中
    const storeType = parsed?.storeType ?? parsed?.store?.storeType ?? null;
    return typeof storeType === 'string' ? storeType : null;
  } catch {
    return null;
  }
}

function deriveBusinessMode(storeType: string | null): StoreBusinessMode | null {
  if (storeType === null) {
    return null;
  }
  return storeType === '餐饮' ? 'catering' : 'general';
}

async function main(): Promise<void> {
  const shouldApply = process.argv.includes('--apply');
  const modeLabel = shouldApply ? 'APPLY（写入数据库）' : 'DRY-RUN（仅预览）';

  console.log(`\n=== 门店业态回填脚本 [${modeLabel}] ===\n`);

  // 读取所有 businessMode = general 的门店
  const stores = await prisma.store.findMany({
    where: { businessMode: 'general' },
    select: { id: true, name: true, businessMode: true },
  });

  console.log(`共找到 ${stores.length} 个 general 业态门店\n`);

  const candidates: StoreBackfillCandidate[] = [];

  for (const store of stores) {
    const cachedStoreType = await getCachedStoreType(store.id);
    const targetMode = deriveBusinessMode(cachedStoreType);

    if (targetMode === 'catering') {
      candidates.push({
        id: store.id,
        name: store.name,
        currentMode: store.businessMode,
        cachedStoreType,
        targetMode,
      });
    }
  }

  // 输出候选列表
  if (candidates.length === 0) {
    console.log('未发现需要回填为 catering 的门店。');
    console.log('可能原因：');
    console.log('  1. Redis 缓存中没有 storeType 数据');
    console.log('  2. 所有门店确实都是非餐饮');
    console.log('  3. 门店已通过注册流程正确写入 businessMode');
    console.log('\n如需手动修正特定门店，请执行：');
    console.log('  UPDATE stores SET business_mode = \'catering\' WHERE id IN (门店ID列表);');
  } else {
    console.log(`发现 ${candidates.length} 个门店需要回填为 catering：\n`);
    console.log('| 门店ID | 门店名称 | 缓存中的 storeType | 目标业态 |');
    console.log('|--------|----------|---------------------|----------|');
    for (const c of candidates) {
      console.log(`| ${c.id} | ${c.name} | ${c.cachedStoreType} | ${c.targetMode} |`);
    }
  }

  // 执行更新
  if (shouldApply && candidates.length > 0) {
    console.log('\n正在更新数据库...');
    for (const c of candidates) {
      await prisma.store.update({
        where: { id: c.id },
        data: { businessMode: c.targetMode },
      });
      console.log(`  ✓ 门店 ${c.id} (${c.name}) → catering`);
    }
    console.log(`\n回填完成，共更新 ${candidates.length} 个门店。`);
  } else if (!shouldApply && candidates.length > 0) {
    console.log('\n以上为预览结果。添加 --apply 参数执行实际更新。');
  }

  // 输出无法自动判断的门店
  const unknownStores = stores.filter(
    (s) => !candidates.find((c) => c.id === s.id),
  );
  if (unknownStores.length > 0) {
    console.log(`\n⚠ 有 ${unknownStores.length} 个门店无法从 Redis 缓存中确认 storeType，`);
    console.log('  需要人工核对后手动修正。');
    console.log('  未确认门店 ID 列表：', unknownStores.map((s) => s.id).join(', '));
  }

  console.log('\n=== 回填脚本执行完毕 ===\n');
}

main()
  .catch((error) => {
    console.error('回填脚本执行失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
