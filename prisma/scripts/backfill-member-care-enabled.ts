/**
 * 会员护理档案档位回填脚本
 *
 * 用途：
 *   1. 把「养生」门店的 storeType 改写为新值「SPA/养生/美容/」
 *   2. 按 storeType 派生 member_care_enabled（仅「SPA/养生/美容/」为 true）
 *
 * 背景：
 *   「养生」这一门店类型被单一模式「SPA/养生/美容/」取代。历史门店的
 *   storeType 存在 stores.profile_metadata JSON 里，迁移 SQL 无法直接改写，
 *   因此需要本脚本完成数据迁移，否则老门店会被判为「未开通」而丢失功能。
 *
 * 执行方式：
 *   npx ts-node prisma/scripts/backfill-member-care-enabled.ts          # 预览
 *   npx ts-node prisma/scripts/backfill-member-care-enabled.ts --apply  # 执行
 *
 * 安全措施：
 *   - 默认 dry-run 模式，只输出将要修改的门店，不写入数据库
 *   - 幂等：重复执行结果一致（已改过的门店不会再进候选列表）
 */

import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
// 门店类型白名单的单一事实源（纯常量模块，零 nest/prisma 依赖）
import { isMemberCareStoreType } from '../../src/purely-profit/stores/store-business-mode';

/** 新模式下唯一启用护理档案的门店类型（单一模式，不是三种） */
const MEMBER_CARE_STORE_TYPE = 'SPA/养生/美容/';
/** 被取代的旧门店类型：同样视为已开通护理档案 */
const LEGACY_STORE_TYPES = ['养生'] as const;

/** Prisma 7 的 datasource 不写 url（见 prisma/schema.prisma），必须显式传驱动适配器 */
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

interface StoreBackfillCandidate {
  id: number;
  name: string;
  currentStoreType: string;
  nextStoreType: string;
  currentEnabled: boolean;
  nextEnabled: boolean;
}

/** 读取门店扩展字段中的 storeType（profile_metadata 是 JSONB） */
function readStoreType(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const storeType = (value as { storeType?: unknown }).storeType;
  return typeof storeType === 'string' ? storeType.trim() : '';
}

async function main(): Promise<void> {
  const shouldApply = process.argv.includes('--apply');
  const modeLabel = shouldApply ? 'APPLY（写入数据库）' : 'DRY-RUN（仅预览）';

  console.log(`\n=== 会员护理档案档位回填脚本 [${modeLabel}] ===\n`);

  const stores = await prisma.store.findMany({
    select: {
      id: true,
      name: true,
      memberCareEnabled: true,
      profileMetadata: true,
    },
  });

  console.log(`共扫描 ${stores.length} 个门店\n`);

  const candidates: StoreBackfillCandidate[] = [];

  for (const store of stores) {
    const currentStoreType = readStoreType(store.profileMetadata);
    // 旧值「养生」视为新模式的等价写法，一并改写为「SPA/养生/美容/」
    const nextStoreType = LEGACY_STORE_TYPES.includes(
      currentStoreType as (typeof LEGACY_STORE_TYPES)[number],
    )
      ? MEMBER_CARE_STORE_TYPE
      : currentStoreType;
    const nextEnabled = isMemberCareStoreType(nextStoreType);

    // 幂等：storeType 与开关都已是目标值时跳过
    if (
      nextStoreType === currentStoreType &&
      nextEnabled === store.memberCareEnabled
    ) {
      continue;
    }

    candidates.push({
      id: store.id,
      name: store.name,
      currentStoreType: currentStoreType || '(空)',
      nextStoreType: nextStoreType || '(空)',
      currentEnabled: store.memberCareEnabled,
      nextEnabled,
    });
  }

  if (candidates.length === 0) {
    console.log('未发现需要回填的门店（数据已是最新）。');
  } else {
    console.log(`发现 ${candidates.length} 个门店需要回填：\n`);
    console.log(
      '| 门店ID | 门店名称 | 原 storeType | 新 storeType | 原开关 | 新开关 |',
    );
    console.log(
      '|--------|----------|--------------|--------------|--------|--------|',
    );
    for (const c of candidates) {
      console.log(
        `| ${c.id} | ${c.name} | ${c.currentStoreType} | ${c.nextStoreType} | ${c.currentEnabled} | ${c.nextEnabled} |`,
      );
    }
  }

  if (shouldApply && candidates.length > 0) {
    console.log('\n正在更新数据库...');
    let updated = 0;
    for (const c of candidates) {
      // 先读一次 metadata，只改 storeType，其余字段原样保留
      const store = await prisma.store.findUnique({
        where: { id: c.id },
        select: { profileMetadata: true },
      });
      const metadata =
        store?.profileMetadata && typeof store.profileMetadata === 'object'
          ? { ...(store.profileMetadata as Record<string, unknown>) }
          : {};
      if (c.nextStoreType !== '') {
        metadata.storeType = c.nextStoreType;
      }

      await prisma.store.update({
        where: { id: c.id },
        data: {
          memberCareEnabled: c.nextEnabled,
          profileMetadata: metadata as unknown as Prisma.InputJsonValue,
        },
      });
      console.log(
        `  ✓ 门店 ${c.id} (${c.name})：storeType=${c.nextStoreType || '(未变)'}，member_care_enabled=${c.nextEnabled}`,
      );
      updated += 1;
    }
    console.log(`\n回填完成，共更新 ${updated} 个门店。`);
  } else if (!shouldApply && candidates.length > 0) {
    console.log('\n以上为预览结果。添加 --apply 参数执行实际更新。');
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
    await pool.end();
  });
