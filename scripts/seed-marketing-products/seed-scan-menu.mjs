// 为账号 13619654040 的餐饮门店 (storeId=37) 批量录入扫码点餐菜单分类与菜单商品。
// 关键点：直接实例化 dist 中编译后的真实业务 Service（ScanOrderingMenuCategoryService /
// ScanOrderingMenuProductService），走与"手动录入"完全相同的代码路径（权限解析、金额转换、
// 重名校验、同表同字段写入），不依赖运行中服务的 HTTP 链路（该链路存在 DI bug）。
import 'dotenv/config';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const require = createRequire(import.meta.url);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const { AccessControlService } = require('../../dist/src/purely-profit/access-control/access-control.service.js');
const { CommerceAccessService } = require('../../dist/src/purely-profit/commerce/commerce-access.service.js');
const {
  ScanOrderingMenuCategoryService,
} = require('../../dist/src/purely-profit/operations/scan-ordering/scan-ordering-menu-category.service.js');
const {
  ScanOrderingMenuProductService,
} = require('../../dist/src/purely-profit/operations/scan-ordering/scan-ordering-menu-product.service.js');

const PHONE = '13619654040';

/** 种子数据：分类 + 其下商品。basePrice 单位：元。stockMode 省略时默认 unlimited。 */
const SEED = [
  {
    name: '招牌推荐',
    sortOrder: 1,
    products: [
      { name: '招牌水煮鱼', basePrice: 88, stockMode: 'finite', stockQuantity: 50 },
      { name: '金牌脆皮鸭', basePrice: 68 },
      { name: '剁椒鱼头', basePrice: 58 },
      { name: '蒜蓉粉丝蒸虾', basePrice: 48 },
      { name: '东坡肘子', basePrice: 56 },
    ],
  },
  {
    name: '热销主食',
    sortOrder: 2,
    products: [
      { name: '招牌牛肉面', basePrice: 22 },
      { name: '重庆小面', basePrice: 15 },
      { name: '扬州炒饭', basePrice: 18 },
      { name: '蛋炒饭', basePrice: 12 },
      { name: '猪肉白菜水饺（12只）', basePrice: 16 },
      { name: '鲜肉馄饨', basePrice: 13 },
      { name: '酸菜肉丝面', basePrice: 18 },
      { name: '京味打卤面', basePrice: 16 },
      { name: '葱油拌面', basePrice: 14 },
      { name: '番茄鸡蛋面', basePrice: 15 },
    ],
  },
  {
    name: '凉菜',
    sortOrder: 3,
    products: [
      { name: '拍黄瓜', basePrice: 8 },
      { name: '凉拌木耳', basePrice: 10 },
      { name: '口水鸡', basePrice: 28 },
      { name: '夫妻肺片', basePrice: 32 },
      { name: '凉拌皮蛋', basePrice: 12 },
      { name: '糖醋萝卜', basePrice: 6 },
      { name: '老醋花生', basePrice: 10 },
    ],
  },
  {
    name: '热菜',
    sortOrder: 4,
    products: [
      { name: '宫保鸡丁', basePrice: 26 },
      { name: '鱼香肉丝', basePrice: 24 },
      { name: '麻婆豆腐', basePrice: 16 },
      { name: '回锅肉', basePrice: 28 },
      { name: '糖醋里脊', basePrice: 30 },
      { name: '干煸四季豆', basePrice: 18 },
      { name: '红烧茄子', basePrice: 16 },
      { name: '农家小炒肉', basePrice: 26 },
      { name: '醋溜土豆丝', basePrice: 12 },
      { name: '清炒时蔬', basePrice: 14 },
      { name: '蒜蓉西兰花', basePrice: 16 },
    ],
  },
  {
    name: '汤羹',
    sortOrder: 5,
    products: [
      { name: '紫菜蛋花汤', basePrice: 8 },
      { name: '番茄蛋汤', basePrice: 8 },
      { name: '冬瓜排骨汤', basePrice: 18 },
      { name: '酸辣汤', basePrice: 12 },
      { name: '玉米排骨汤', basePrice: 18 },
      { name: '银耳莲子羹', basePrice: 10 },
    ],
  },
  {
    name: '米饭套餐',
    sortOrder: 6,
    products: [
      { name: '卤肉饭套餐', basePrice: 22 },
      { name: '照烧鸡腿饭套餐', basePrice: 25 },
      { name: '猪脚饭套餐', basePrice: 26 },
      { name: '叉烧饭套餐', basePrice: 24 },
    ],
  },
  {
    name: '小吃',
    sortOrder: 7,
    products: [
      { name: '春卷', basePrice: 10 },
      { name: '炸薯条', basePrice: 12 },
      { name: '香酥鸡柳', basePrice: 16 },
      { name: '南瓜饼', basePrice: 8 },
      { name: '奶黄包', basePrice: 6 },
      { name: '小笼包（6只）', basePrice: 12 },
    ],
  },
  {
    name: '饮品',
    sortOrder: 8,
    products: [
      { name: '可乐', basePrice: 5 },
      { name: '雪碧', basePrice: 5 },
      { name: '鲜榨橙汁', basePrice: 12 },
      { name: '酸梅汤', basePrice: 8 },
      { name: '王老吉', basePrice: 6 },
      { name: '柠檬水', basePrice: 6 },
      { name: '珍珠奶茶', basePrice: 12 },
    ],
  },
  {
    name: '酒水',
    sortOrder: 9,
    products: [
      { name: '青岛啤酒', basePrice: 8 },
      { name: '雪花啤酒', basePrice: 8 },
      { name: '白酒（小瓶）', basePrice: 18 },
      { name: '红酒（杯）', basePrice: 28 },
    ],
  },
  {
    name: '甜品',
    sortOrder: 10,
    products: [
      { name: '杨枝甘露', basePrice: 16 },
      { name: '芒果布丁', basePrice: 12 },
      { name: '红豆沙', basePrice: 8 },
      { name: '双皮奶', basePrice: 10 },
    ],
  },
  {
    name: '烧烤',
    sortOrder: 11,
    products: [
      { name: '羊肉串', basePrice: 5, stockMode: 'finite', stockQuantity: 200 },
      { name: '牛肉串', basePrice: 6, stockMode: 'finite', stockQuantity: 200 },
      { name: '烤鸡翅', basePrice: 8 },
      { name: '烤茄子', basePrice: 12 },
      { name: '烤韭菜', basePrice: 8 },
      { name: '烤玉米', basePrice: 6 },
    ],
  },
  {
    name: '火锅配菜',
    sortOrder: 12,
    products: [
      { name: '肥牛卷', basePrice: 32 },
      { name: '羊肉卷', basePrice: 32 },
      { name: '虾滑', basePrice: 28 },
      { name: '毛肚', basePrice: 26 },
      { name: '午餐肉', basePrice: 16 },
      { name: '金针菇', basePrice: 10 },
      { name: '娃娃菜', basePrice: 8 },
      { name: '老豆腐', basePrice: 8 },
      { name: '土豆片', basePrice: 6 },
    ],
  },
];

async function main() {
  const staff = await prisma.staff.findFirst({ where: { phone: PHONE } });
  if (!staff) throw new Error(`未找到 staff (phone=${PHONE})`);
  console.log(`staff: id=${staff.id} storeId=${staff.storeId} role=${staff.role}`);

  const store = await prisma.store.findUnique({
    where: { id: staff.storeId },
    select: { id: true, name: true, businessMode: true },
  });
  console.log(`store: ${JSON.stringify(store)}`);
  if (!store) throw new Error(`门店不存在 storeId=${staff.storeId}`);

  // 构造与 JWT 鉴权链完全一致的 membership 上下文（owner/staff 走默认角色权限合并）
  const accessControlService = new AccessControlService();
  const membership = accessControlService.buildMembershipContext(
    {
      id: staff.id,
      storeId: staff.storeId,
      role: staff.role,
      permissions: staff.permissions,
      isActive: staff.isActive,
      linkedEmployeeId: null,
    },
    null,
    'catering',
  );
  const user = { currentMembership: membership };

  const commerceAccessService = new CommerceAccessService(accessControlService);
  const categoryService = new ScanOrderingMenuCategoryService(prisma, commerceAccessService);
  const productService = new ScanOrderingMenuProductService(prisma, commerceAccessService);

  // 幂等预检：已有同名分类 / 商品直接跳过
  const existingCategories = await prisma.scanOrderingMenuCategory.findMany({
    where: { storeId: staff.storeId, deletedAt: null },
    select: { name: true, id: true },
  });
  const existingProducts = await prisma.scanOrderingMenuProduct.findMany({
    where: { storeId: staff.storeId, deletedAt: null },
    select: { name: true, categoryId: true },
  });
  const existingCategoryNames = new Set(existingCategories.map((c) => c.name));
  const existingProductNames = new Set(existingProducts.map((p) => p.name));
  console.log(
    `当前已有: 分类 ${existingCategories.length} 个, 商品 ${existingProducts.length} 个`,
  );

  const categoryIdByName = new Map(
    existingCategories.map((c) => [c.name, c.id]),
  );
  let createdCategories = 0;
  let createdProducts = 0;
  let skippedCategories = 0;
  let skippedProducts = 0;

  for (const categorySeed of SEED) {
    let categoryId = categoryIdByName.get(categorySeed.name);
    if (categoryId === undefined) {
      const created = await categoryService.createCategory(user, {
        name: categorySeed.name,
        sortOrder: categorySeed.sortOrder,
      });
      categoryId = created.id;
      createdCategories += 1;
      console.log(`  + 分类: ${categorySeed.name} (id=${categoryId})`);
    } else {
      skippedCategories += 1;
    }

    for (const productSeed of categorySeed.products) {
      if (existingProductNames.has(productSeed.name)) {
        skippedProducts += 1;
        continue;
      }
      await productService.createProduct(user, {
        categoryId,
        name: productSeed.name,
        basePrice: productSeed.basePrice,
        ...(productSeed.stockMode ? { stockMode: productSeed.stockMode } : {}),
        ...(productSeed.stockQuantity !== undefined
          ? { stockQuantity: productSeed.stockQuantity }
          : {}),
      });
      createdProducts += 1;
    }
  }

  const finalCategories = await prisma.scanOrderingMenuCategory.count({
    where: { storeId: staff.storeId, deletedAt: null },
  });
  const finalProducts = await prisma.scanOrderingMenuProduct.count({
    where: { storeId: staff.storeId, deletedAt: null },
  });

  console.log('--- 汇总 ---');
  console.log(
    `新增分类 ${createdCategories} 个（跳过 ${skippedCategories}），新增商品 ${createdProducts} 个（跳过 ${skippedProducts}）`,
  );
  console.log(`门店 ${store.name}(id=${staff.storeId}) 现有分类 ${finalCategories} 个、商品 ${finalProducts} 个`);
}

main()
  .catch((e) => {
    console.error('错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
