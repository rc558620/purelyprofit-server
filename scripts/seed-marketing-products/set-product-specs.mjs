// 为门店 37 的挑选商品配置扫码菜单规格，覆盖所有能出现的规格组合类型：
//   - 单选必选 (single, min=1)
//   - 单选可跳过 (single, min=0)
//   - 多选限选 (multi, max=N < 选项数)
//   - 多选不限 (multi, max=null)
//   - 多选必选+限选 (multi, min>=1)
//   - 组合场景：单选+多选、双单选+多选、多规格组
// 走真实业务逻辑 ProductsScanOrderingSyncService.syncSpecifications()（含校验与缓存失效）。
// 幂等可重跑（syncSpecifications 会先删除该商品旧的规格组/选项再重建）。
// 用法: node scripts/seed-marketing-products/set-product-specs.mjs
import 'dotenv/config';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import Redis from 'ioredis';

const require = createRequire(import.meta.url);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const { ProductsScanOrderingSyncService } = require('../../dist/src/purely-profit/goods/products/products-scan-ordering-sync.service.js');

const STORE_ID = 37;

// 规格配置：商品名 -> 规格组列表
const SPECS = {
  招牌水煮鱼: [
    {
      name: '辣度',
      selectMode: 'single',
      minSelect: 1,
      maxSelect: 1,
      sort: 0,
      options: [
        { name: '不辣', priceDelta: 0, isDefault: true, isActive: true },
        { name: '微辣', priceDelta: 0, isDefault: false, isActive: true },
        { name: '中辣', priceDelta: 0, isDefault: false, isActive: true },
        { name: '特辣', priceDelta: 0, isDefault: false, isActive: true },
      ],
    },
    {
      name: '加料',
      selectMode: 'multi',
      minSelect: 0,
      maxSelect: 2,
      sort: 1,
      options: [
        { name: '加鱼丸', priceDelta: 3, isDefault: false, isActive: true },
        { name: '加豆腐', priceDelta: 2, isDefault: false, isActive: true },
        { name: '加宽粉', priceDelta: 3, isDefault: false, isActive: true },
        { name: '加青菜', priceDelta: 2, isDefault: false, isActive: true },
      ],
    },
  ],
  珍珠奶茶: [
    {
      name: '杯型',
      selectMode: 'single',
      minSelect: 1,
      maxSelect: 1,
      sort: 0,
      options: [
        { name: '中杯', priceDelta: 0, isDefault: true, isActive: true },
        { name: '大杯', priceDelta: 3, isDefault: false, isActive: true },
        { name: '超大杯', priceDelta: 5, isDefault: false, isActive: true },
      ],
    },
    {
      name: '甜度',
      selectMode: 'single',
      minSelect: 1,
      maxSelect: 1,
      sort: 1,
      options: [
        { name: '无糖', priceDelta: 0, isDefault: false, isActive: true },
        { name: '三分糖', priceDelta: 0, isDefault: true, isActive: true },
        { name: '五分糖', priceDelta: 0, isDefault: false, isActive: true },
        { name: '全糖', priceDelta: 0, isDefault: false, isActive: true },
      ],
    },
    {
      name: '加料',
      selectMode: 'multi',
      minSelect: 0,
      maxSelect: null,
      sort: 2,
      options: [
        { name: '珍珠', priceDelta: 2, isDefault: false, isActive: true },
        { name: '椰果', priceDelta: 2, isDefault: false, isActive: true },
        { name: '布丁', priceDelta: 3, isDefault: false, isActive: true },
        { name: '芋圆', priceDelta: 3, isDefault: false, isActive: true },
      ],
    },
  ],
  招牌牛肉面: [
    {
      name: '面条软硬',
      selectMode: 'single',
      minSelect: 1,
      maxSelect: 1,
      sort: 0,
      options: [
        { name: '软面', priceDelta: 0, isDefault: false, isActive: true },
        { name: '适中', priceDelta: 0, isDefault: true, isActive: true },
        { name: '硬面', priceDelta: 0, isDefault: false, isActive: true },
      ],
    },
    {
      name: '加料',
      selectMode: 'multi',
      minSelect: 0,
      maxSelect: 2,
      sort: 1,
      options: [
        { name: '加牛肉', priceDelta: 8, isDefault: false, isActive: true },
        { name: '加蛋', priceDelta: 2, isDefault: false, isActive: true },
        { name: '加青菜', priceDelta: 2, isDefault: false, isActive: true },
        { name: '加卤蛋', priceDelta: 3, isDefault: false, isActive: true },
      ],
    },
    {
      name: '辣度',
      selectMode: 'single',
      minSelect: 0,
      maxSelect: 1,
      sort: 2,
      options: [
        { name: '不辣', priceDelta: 0, isDefault: true, isActive: true },
        { name: '微辣', priceDelta: 0, isDefault: false, isActive: true },
        { name: '中辣', priceDelta: 0, isDefault: false, isActive: true },
        { name: '特辣', priceDelta: 0, isDefault: false, isActive: true },
      ],
    },
  ],
  '小笼包（6只）': [
    {
      name: '份量',
      selectMode: 'single',
      minSelect: 1,
      maxSelect: 1,
      sort: 0,
      options: [
        { name: '6只', priceDelta: 0, isDefault: true, isActive: true },
        { name: '10只', priceDelta: 8, isDefault: false, isActive: true },
      ],
    },
  ],
  烤鸡翅: [
    {
      name: '辣度',
      selectMode: 'single',
      minSelect: 1,
      maxSelect: 1,
      sort: 0,
      options: [
        { name: '不辣', priceDelta: 0, isDefault: false, isActive: true },
        { name: '微辣', priceDelta: 0, isDefault: true, isActive: true },
        { name: '中辣', priceDelta: 0, isDefault: false, isActive: true },
        { name: '特辣', priceDelta: 0, isDefault: false, isActive: true },
      ],
    },
    {
      name: '口味',
      selectMode: 'multi',
      minSelect: 1,
      maxSelect: 2,
      sort: 1,
      options: [
        { name: '孜然', priceDelta: 0, isDefault: false, isActive: true },
        { name: '麻辣', priceDelta: 0, isDefault: false, isActive: true },
        { name: '蜜汁', priceDelta: 0, isDefault: false, isActive: true },
        { name: '蒜香', priceDelta: 0, isDefault: false, isActive: true },
      ],
    },
  ],
};

let redis;

async function main() {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number.parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: 1,
  });
  const redisSafe = {
    del: async (key) => {
      try {
        await redis.del(key);
      } catch {
        /* ignore */
      }
    },
  };
  const scanOrderingSyncService = new ProductsScanOrderingSyncService(prisma, redisSafe);

  const products = await prisma.product.findMany({
    where: { storeId: STORE_ID, deletedAt: null, name: { in: Object.keys(SPECS) } },
    select: { id: true, name: true },
  });
  const productIdByName = new Map(products.map((p) => [p.name, p.id]));
  const missing = Object.keys(SPECS).filter((name) => !productIdByName.has(name));
  if (missing.length > 0) {
    throw new Error(`未找到商品: ${missing.join(', ')}`);
  }

  let totalGroups = 0;
  let totalOptions = 0;
  for (const [name, groups] of Object.entries(SPECS)) {
    const productId = productIdByName.get(name);
    // 真实业务逻辑：校验 + 重建规格组/选项 + 失效缓存
    await scanOrderingSyncService.syncSpecifications(STORE_ID, productId, groups);
    const groupCount = groups.length;
    const optionCount = groups.reduce((sum, g) => sum + g.options.length, 0);
    totalGroups += groupCount;
    totalOptions += optionCount;
    console.log(
      `  ~ ${name} (product#${productId}): ${groupCount} 个规格组 / ${optionCount} 个选项`,
    );
  }

  // 清缓存兜底
  try {
    await redis.del(`scanordering:menu:${STORE_ID}`);
  } catch {
    /* ignore */
  }

  console.log('--- 汇总 ---');
  console.log(`已为 ${Object.keys(SPECS).length} 个商品配置规格: 共 ${totalGroups} 个规格组 / ${totalOptions} 个选项`);
}

main()
  .catch((e) => {
    console.error('错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    redis?.disconnect();
  });
