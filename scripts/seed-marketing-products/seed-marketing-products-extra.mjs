// 为账号 13619654022 的测试门店2 (storeId=42) 批量新增 40 个营销商品（MarketingProduct）。
// 背景：门店 42 已有 12 个手动录入的营销商品（推拿按摩/美容护肤 两分类），测试需要更多数据。
// 方案：按手动录入的结构直接写 marketing_products 表，字段与手动录入完全一致：
//   price/originalPrice 存分、descriptionTitle/description 中文描述、stock、durationMinutes、
//   personCount、unit（次/份）、isActive=true；划线价均高于售价，同门店同名唯一约束幂等跳过。
// 幂等可重跑：同 storeId+name 已存在则跳过。
// 用法: node scripts/seed-marketing-products/seed-marketing-products-extra.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PHONE = '13619654022';

// 40 个测试商品（与手动录入一致的字段结构；price/originalPrice 单位为分）
// categoryId: 1=推拿按摩, 2=美容护肤
const SEED_PRODUCTS = [
  // ---- 推拿按摩 (categoryId=1) 20 个 ----
  { categoryId: 1, name: '泰式古法按摩', price: 9800, originalPrice: 12800, descriptionTitle: '服务内容', description: '传统泰式手法拉伸放松，缓解全身疲劳', stock: 50, durationMinutes: 60, personCount: 1, unit: '次' },
  { categoryId: 1, name: '头疗放松', price: 6800, originalPrice: 8800, descriptionTitle: '服务内容', description: '头部穴位按摩配合精油，舒缓压力', stock: 60, durationMinutes: 30, personCount: 1, unit: '次' },
  { categoryId: 1, name: '足浴养生', price: 8800, originalPrice: 11800, descriptionTitle: '服务内容', description: '中药足浴搭配足底按摩，活血养生', stock: 70, durationMinutes: 50, personCount: 1, unit: '次' },
  { categoryId: 1, name: '刮痧拔罐', price: 4800, originalPrice: 6800, descriptionTitle: '服务内容', description: '传统刮痧拔罐组合，祛湿排毒', stock: 80, durationMinutes: 40, personCount: 1, unit: '次' },
  { categoryId: 1, name: '艾灸温养', price: 6800, originalPrice: 8800, descriptionTitle: '服务内容', description: '陈年艾条温灸，驱寒暖宫调理体质', stock: 60, durationMinutes: 45, personCount: 1, unit: '次' },
  { categoryId: 1, name: '小儿推拿', price: 7800, originalPrice: 9800, descriptionTitle: '服务内容', description: '专业小儿推拿，调理积食与睡眠', stock: 40, durationMinutes: 30, personCount: 1, unit: '次' },
  { categoryId: 1, name: '产后修复推拿', price: 12800, originalPrice: 16800, descriptionTitle: '服务内容', description: '针对产后妈妈定制，帮助形体恢复', stock: 30, durationMinutes: 60, personCount: 1, unit: '次' },
  { categoryId: 1, name: '运动拉伸放松', price: 9800, originalPrice: 12800, descriptionTitle: '服务内容', description: '运动后深度拉伸，缓解肌肉酸痛', stock: 50, durationMinutes: 45, personCount: 1, unit: '次' },
  { categoryId: 1, name: '淋巴排毒按摩', price: 10800, originalPrice: 14800, descriptionTitle: '服务内容', description: '轻柔手法促进淋巴循环，排出毒素', stock: 40, durationMinutes: 60, personCount: 1, unit: '次' },
  { categoryId: 1, name: '香薰精油SPA', price: 15800, originalPrice: 19800, descriptionTitle: '服务内容', description: '精选香薰精油全身SPA，身心焕新', stock: 25, durationMinutes: 90, personCount: 1, unit: '次' },
  { categoryId: 1, name: '肩颈腰背组合', price: 12800, originalPrice: 16800, descriptionTitle: '套餐说明', description: '肩颈+腰背分段调理，一次解决久坐酸痛', stock: 45, durationMinutes: 60, personCount: 1, unit: '次' },
  { categoryId: 1, name: '经络足疗套餐', price: 15800, originalPrice: 19800, descriptionTitle: '套餐说明', description: '足浴+足底按摩+小腿放松三合一', stock: 20, durationMinutes: 90, personCount: 1, unit: '份' },
  { categoryId: 1, name: '双人推拿套餐', price: 25800, originalPrice: 32800, descriptionTitle: '套餐说明', description: '两人同行各享中式推拿一次，更优惠', stock: 15, durationMinutes: 90, personCount: 2, unit: '份' },
  { categoryId: 1, name: '四人养生套餐', price: 45800, originalPrice: 59800, descriptionTitle: '套餐说明', description: '四人组团养生，含足浴与推拿各一次', stock: 8, durationMinutes: 120, personCount: 4, unit: '份' },
  { categoryId: 1, name: '热石能量按摩', price: 11800, originalPrice: 15800, descriptionTitle: '服务内容', description: '温热血石配合精油，深层放松肌肉', stock: 35, durationMinutes: 60, personCount: 1, unit: '次' },
  { categoryId: 1, name: '生姜驱寒足浴', price: 6800, originalPrice: 8800, descriptionTitle: '服务内容', description: '生姜足浴发汗驱寒，适合畏寒人群', stock: 60, durationMinutes: 45, personCount: 1, unit: '次' },
  { categoryId: 1, name: '耳穴调理', price: 3800, originalPrice: 5800, descriptionTitle: '服务内容', description: '耳穴贴压调理睡眠与亚健康状态', stock: 90, durationMinutes: 20, personCount: 1, unit: '次' },
  { categoryId: 1, name: '腹部暖宫按摩', price: 8800, originalPrice: 11800, descriptionTitle: '服务内容', description: '暖宫手法配合艾灸，缓解经期不适', stock: 50, durationMinutes: 40, personCount: 1, unit: '次' },
  { categoryId: 1, name: '背部舒缓按摩', price: 5800, originalPrice: 7800, descriptionTitle: '服务内容', description: '重点舒缓背部紧绷肌群，轻松入眠', stock: 70, durationMinutes: 35, personCount: 1, unit: '次' },
  { categoryId: 1, name: '全身芳香SPA', price: 13800, originalPrice: 17800, descriptionTitle: '注意事项', description: '全身芳香SPA，请提前15分钟到店', stock: 30, durationMinutes: 80, personCount: 1, unit: '次' },
  // ---- 美容护肤 (categoryId=2) 20 个 ----
  { categoryId: 2, name: '氨基酸洁面护理', price: 8800, originalPrice: 11800, descriptionTitle: '服务内容', description: '温和氨基酸清洁，不伤皮肤屏障', stock: 40, durationMinutes: 40, personCount: 1, unit: '次' },
  { categoryId: 2, name: '玻尿酸导入护理', price: 16800, originalPrice: 21800, descriptionTitle: '服务内容', description: '玻尿酸仪器导入，深层补水锁水', stock: 30, durationMinutes: 60, personCount: 1, unit: '次' },
  { categoryId: 2, name: '烟酰胺美白护理', price: 14800, originalPrice: 19800, descriptionTitle: '服务内容', description: '烟酰胺精华提亮肤色，改善暗沉', stock: 30, durationMinutes: 60, personCount: 1, unit: '次' },
  { categoryId: 2, name: '紧致抗皱护理', price: 19800, originalPrice: 25800, descriptionTitle: '服务内容', description: '射频仪器搭配抗皱精华，紧致轮廓', stock: 25, durationMinutes: 75, personCount: 1, unit: '次' },
  { categoryId: 2, name: '眼部SPA护理', price: 8800, originalPrice: 12800, descriptionTitle: '服务内容', description: '眼周穴位按摩+眼膜，淡化细纹黑眼圈', stock: 60, durationMinutes: 30, personCount: 1, unit: '次' },
  { categoryId: 2, name: '颈部护理', price: 9800, originalPrice: 13800, descriptionTitle: '服务内容', description: '颈部紧致护理，改善颈纹与松弛', stock: 50, durationMinutes: 40, personCount: 1, unit: '次' },
  { categoryId: 2, name: '唇部护理', price: 3800, originalPrice: 5800, descriptionTitle: '服务内容', description: '唇部去角质+滋养，水润嘟嘟唇', stock: 80, durationMinutes: 20, personCount: 1, unit: '次' },
  { categoryId: 2, name: '手膜护理', price: 4800, originalPrice: 6800, descriptionTitle: '服务内容', description: '手部去角质+手膜滋养，嫩滑双手', stock: 70, durationMinutes: 30, personCount: 1, unit: '次' },
  { categoryId: 2, name: '背部祛痘护理', price: 12800, originalPrice: 16800, descriptionTitle: '服务内容', description: '背部清洁消炎，改善痘痘粉刺', stock: 40, durationMinutes: 60, personCount: 1, unit: '次' },
  { categoryId: 2, name: '光子嫩肤体验', price: 25800, originalPrice: 32800, descriptionTitle: '注意事项', description: '光子嫩肤体验，术后注意防晒', stock: 20, durationMinutes: 45, personCount: 1, unit: '次' },
  { categoryId: 2, name: '清洁补水组合', price: 16800, originalPrice: 21800, descriptionTitle: '套餐说明', description: '深层清洁+玻尿酸导入组合，一步到位', stock: 25, durationMinutes: 90, personCount: 1, unit: '份' },
  { categoryId: 2, name: '全脸护理套餐', price: 32800, originalPrice: 42800, descriptionTitle: '套餐说明', description: '清洁+提拉+补水全流程护理', stock: 15, durationMinutes: 120, personCount: 1, unit: '份' },
  { categoryId: 2, name: '闺蜜美甲套餐', price: 13800, originalPrice: 18800, descriptionTitle: '套餐说明', description: '两人同行基础美甲+手膜护理各一次', stock: 20, durationMinutes: 90, personCount: 2, unit: '份' },
  { categoryId: 2, name: '母亲节护理套餐', price: 26800, originalPrice: 35800, descriptionTitle: '套餐说明', description: '母女同行，含面部护理各一次', stock: 12, durationMinutes: 90, personCount: 2, unit: '份' },
  { categoryId: 2, name: '敏感肌舒缓护理', price: 12800, originalPrice: 16800, descriptionTitle: '服务内容', description: '敏感肌专用舒缓精华，修复泛红', stock: 35, durationMinutes: 50, personCount: 1, unit: '次' },
  { categoryId: 2, name: '头皮护理', price: 6800, originalPrice: 8800, descriptionTitle: '服务内容', description: '头皮清洁+按摩，改善出油脱发', stock: 60, durationMinutes: 35, personCount: 1, unit: '次' },
  { categoryId: 2, name: '全身焕肤SPA', price: 22800, originalPrice: 29800, descriptionTitle: '服务内容', description: '全身磨砂焕肤，肌肤如新生', stock: 20, durationMinutes: 90, personCount: 1, unit: '次' },
  { categoryId: 2, name: '婚前新娘护理包', price: 38800, originalPrice: 49800, descriptionTitle: '套餐说明', description: '新娘婚前密集护理，含3次面部护理', stock: 10, durationMinutes: 150, personCount: 1, unit: '份' },
  { categoryId: 2, name: '男士清爽护理', price: 9800, originalPrice: 12800, descriptionTitle: '服务内容', description: '男士专用清洁控油护理，清爽不油腻', stock: 50, durationMinutes: 45, personCount: 1, unit: '次' },
  { categoryId: 2, name: '泡澡浴盐护理', price: 8800, originalPrice: 11800, descriptionTitle: '服务内容', description: '浴盐泡浴放松身心，促进循环', stock: 45, durationMinutes: 60, personCount: 1, unit: '次' },
];

async function main() {
  const staff = await prisma.staff.findFirst({ where: { phone: PHONE } });
  if (!staff) throw new Error(`未找到 staff (phone=${PHONE})`);
  const storeId = staff.storeId;
  console.log(`staff: id=${staff.id} storeId=${storeId} role=${staff.role}`);

  // 校验分类归属（仅使用本门店已有分类）
  const categories = await prisma.marketingProductCategory.findMany({
    where: { storeId },
    select: { id: true, name: true },
  });
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const seedCategoryIds = new Set(SEED_PRODUCTS.map((p) => p.categoryId));
  for (const categoryId of seedCategoryIds) {
    if (!categoryNameById.has(categoryId)) {
      throw new Error(`分类不存在或不属于当前门店 categoryId=${categoryId}`);
    }
  }

  // 现有营销商品（name -> id），用于幂等跳过（同门店同名唯一约束）
  const existingProducts = await prisma.marketingProduct.findMany({
    where: { storeId },
    select: { id: true, name: true },
  });
  const existingByName = new Map(existingProducts.map((p) => [p.name, p.id]));
  console.log(
    `当前门店营销商品: ${existingProducts.length} 个, 分类: ${[...categoryNameById.values()].join('、')}`,
  );

  let created = 0;
  let skipped = 0;

  for (const item of SEED_PRODUCTS) {
    if (existingByName.has(item.name)) {
      skipped += 1;
      console.log(`  = 跳过已存在: ${item.name} (id=${existingByName.get(item.name)})`);
      continue;
    }
    const record = await prisma.marketingProduct.create({
      data: {
        storeId,
        categoryId: item.categoryId,
        name: item.name,
        price: item.price,
        originalPrice: item.originalPrice,
        descriptionTitle: item.descriptionTitle,
        description: item.description,
        stock: item.stock,
        durationMinutes: item.durationMinutes,
        personCount: item.personCount,
        unit: item.unit,
        isActive: true,
      },
    });
    created += 1;
    console.log(
      `  + 营销商品: ${item.name} (id=${record.id}, ¥${(item.price / 100).toFixed(2)}, ${categoryNameById.get(item.categoryId)}/${item.unit}, ${item.durationMinutes}min)`,
    );
  }

  const finalTotal = await prisma.marketingProduct.count({ where: { storeId } });
  console.log('--- 汇总 ---');
  console.log(`新增营销商品 ${created} 个, 跳过已存在 ${skipped} 个`);
  console.log(
    `门店 ${staff.storeId} 现有营销商品共 ${finalTotal} 个（新增前 ${existingProducts.length} 个）`,
  );
}

// 种子脚本需在 Nest 启动前直接连库，DATABASE_URL 直读为既有脚本先例（检查器面向 src/ 业务代码）
try {
  await main();
} catch (e) {
  console.error('错误:', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await pool.end();
}
