/**
 * 3-A-1 真实库翻页验证（原生 SQL 游标路径）。
 *
 * 上一轮 `/members`、`/inventory/adjustments` 只有 SQL 形态断言，
 * 无法证明「同排序值多行」在真实 PostgreSQL 上不漏不重——SQL 看起来对
 * 与索引扫描 / 时间列同型 / 游标比较逻辑真正成立是两回事。
 *
 * 本用例直连 DATABASE_URL：
 *   1. 取一个真实门店（会员）与一个真实商品（库存流水外键）；
 *   2. 造 3 条 `updated_at` / `created_at` 完全相同的记录（最容易漏读的形状）；
 *   3. 逐页走游标，断言「全量 id 序列 == 一次拉取」「无重复」「末页 nextCursor=null」；
 *   4. 清理自己造的数据。
 *
 * 运行：node --experimental-vm-modules node_modules/jest/bin/jest.js \
 *        --config ./test/jest-e2e.json --runInBand cursor-pagination-real-db
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import configuration from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import type { AuthenticatedUser } from '../src/purely-profit/auth/strategies/jwt.strategy';
import type { CommerceAccessService } from '../src/purely-profit/commerce/commerce-access.service';
import type { PlatformMembershipAccessService } from '../src/purely-profit/member/platform-membership/platform-membership-access.service';
import type { MembersAccessService } from '../src/purely-profit/member/members/members-access.service';
import { MembersReadService } from '../src/purely-profit/member/members/members-read.service';
import { InventoryReadService } from '../src/purely-profit/goods/inventory/inventory-read.service';

/**
 * 造数标记：唯一前缀，既是筛选隔离键，也是清理依据。
 *
 * 刻意只用字母数字：会员列表的 keyword 走 `ILIKE '%kw%'` 且不做通配符转义，
 * 标记里带 `_` / `%` 会让隔离条件退化成通配符匹配，可能圈进别人的数据。
 */
const PROBE_TAG = `cursorprobe${Date.now()}`;
/** 3 条记录共用的时间戳：同值行是游标分页唯一会静默漏读的形状 */
const SAME_TIME = new Date('2026-11-10T02:00:00.000Z');
const OLDER_TIME = new Date('2026-11-09T02:00:00.000Z');
const SEED_COUNT = 5;
const PAGE_SIZE = 2;

const user = {} as AuthenticatedUser;

describe('游标分页真实库验证（members / inventory adjustments）', () => {
  let prisma: PrismaService;
  let configService: ConfigService;
  let membersReadService: MembersReadService;
  let inventoryReadService: InventoryReadService;
  let moduleRef: TestingModule;
  let storeId: number | null = null;
  let productId: number | null = null;
  let memberIds: number[] = [];
  let adjustmentIds: number[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      ],
    }).compile();
    configService = moduleRef.get(ConfigService);
    prisma = new PrismaService(configService);
    await prisma.$connect();

    // 复用真实门店/商品：会员与库存流水都带外键，凭空造门店会污染更多表
    const store = await prisma.store.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    storeId = store?.id ?? null;
    const product = storeId
      ? await prisma.product.findFirst({
          where: { storeId },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      : null;
    productId = product?.id ?? null;

    membersReadService = new MembersReadService(
      prisma,
      {
        resolveMembersViewStoreId: () => Promise.resolve(storeId),
      } as unknown as MembersAccessService,
      configService,
      {
        getOrLoadRefreshableJson: (options: {
          loadValue: () => Promise<unknown>;
        }) => options.loadValue(),
        writeRefreshableJson: () => Promise.resolve(),
      } as never,
    );
    inventoryReadService = new InventoryReadService(
      prisma,
      configService,
      {
        resolveViewStoreId: () => Promise.resolve(storeId),
      } as unknown as CommerceAccessService,
      {} as unknown as PlatformMembershipAccessService,
    );

    if (storeId === null || productId === null) {
      return;
    }

    await seedMembers(storeId);
    await seedAdjustments(storeId, productId);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      if (memberIds.length > 0) {
        const removed = await prisma.member.deleteMany({
          where: { id: { in: memberIds } },
        });
        // 清理自证：删除条数必须等于造数条数，避免测试数据残留污染真实库
        expect(removed.count).toBe(memberIds.length);
      }
      if (adjustmentIds.length > 0) {
        const removed = await prisma.inventoryAdjustmentLog.deleteMany({
          where: { id: { in: adjustmentIds } },
        });
        expect(removed.count).toBe(adjustmentIds.length);
      }
      await prisma.$disconnect();
    }
    await moduleRef?.close();
  }, 60_000);

  /** 造 3 条同 updated_at + 2 条更早的会员，全部带 PROBE_TAG 名称前缀 */
  async function seedMembers(targetStoreId: number): Promise<void> {
    await prisma.member.createMany({
      data: [1, 2, 3].map((seq) => ({
        storeId: targetStoreId,
        name: `${PROBE_TAG}-member-${seq}`,
        phone: null,
        createdAt: SAME_TIME,
        updatedAt: SAME_TIME,
      })),
    });
    await prisma.member.createMany({
      data: [4, 5].map((seq) => ({
        storeId: targetStoreId,
        name: `${PROBE_TAG}-member-${seq}`,
        phone: null,
        createdAt: OLDER_TIME,
        updatedAt: OLDER_TIME,
      })),
    });
    const rows = await prisma.member.findMany({
      where: { storeId: targetStoreId, name: { startsWith: PROBE_TAG } },
      select: { id: true },
    });
    memberIds = rows.map((row) => row.id);
  }

  /** 造 3 条同 created_at + 2 条更早的库存流水（product_name 带 PROBE_TAG 用于隔离） */
  async function seedAdjustments(
    targetStoreId: number,
    targetProductId: number,
  ): Promise<void> {
    const buildRow = (seq: number, createdAt: Date) => ({
      storeId: targetStoreId,
      productId: targetProductId,
      productName: `${PROBE_TAG}-product-${seq}`,
      beforeStock: 10,
      afterStock: 15,
      delta: 5,
      adjustType: 'restock' as const,
      createdAt,
    });

    await prisma.inventoryAdjustmentLog.createMany({
      data: [1, 2, 3].map((seq) => buildRow(seq, SAME_TIME)),
    });
    await prisma.inventoryAdjustmentLog.createMany({
      data: [4, 5].map((seq) => buildRow(seq, OLDER_TIME)),
    });
    const rows = await prisma.inventoryAdjustmentLog.findMany({
      where: { storeId: targetStoreId, productName: { startsWith: PROBE_TAG } },
      select: { id: true },
    });
    adjustmentIds = rows.map((row) => row.id);
  }

  /**
   * 逐页走游标：返回完整 id 序列与每页的 total，顺带断言到底判定收敛。
   *
   * @param startCursor 可选起点：用于「先翻若干页、插入并发写、再从原游标续翻」的场景
   */
  async function walkPages(
    fetchPage: (cursor?: string) => Promise<{
      ids: string[];
      total: number;
      hasMore: boolean;
      nextCursor: string | null;
    }>,
    startCursor?: string,
  ): Promise<{ ids: string[]; totals: number[] }> {
    const ids: string[] = [];
    const totals: number[] = [];
    let cursor: string | undefined = startCursor;
    // 防御：翻页不收敛时立即失败，避免用例挂死
    for (let round = 0; round <= SEED_COUNT + 1; round += 1) {
      const page = await fetchPage(cursor);
      ids.push(...page.ids);
      totals.push(page.total);
      if (!page.hasMore) {
        // 到底判定：hasMore 与 nextCursor 必须同时收敛
        expect(page.nextCursor).toBeNull();
        return { ids, totals };
      }
      expect(page.nextCursor).not.toBeNull();
      cursor = page.nextCursor ?? undefined;
    }
    throw new Error('游标翻页未收敛，疑似游标条件失效导致原地打转');
  }

  it('会员列表：同 updated_at 多行真实库翻页不漏不重', async () => {
    if (storeId === null) {
      console.warn('[skip] 库里没有可用门店，会员游标翻页验证跳过');
      return;
    }

    const oneShot = await membersReadService.list(user, {
      keyword: PROBE_TAG,
      pageSize: 100,
    });
    expect(oneShot.items).toHaveLength(SEED_COUNT);
    expect(oneShot.hasMore).toBe(false);
    expect(oneShot.nextCursor).toBeNull();

    // 造数自检：确实存在 3 条 updated_at 完全相同的行
    const seededRows = await prisma.member.findMany({
      where: { id: { in: memberIds } },
      select: { updatedAt: true },
    });
    expect(
      seededRows.filter(
        (row) => row.updatedAt.getTime() === SAME_TIME.getTime(),
      ),
    ).toHaveLength(3);

    const walked = await walkPages(async (cursor) => {
      const page = await membersReadService.list(user, {
        keyword: PROBE_TAG,
        pageSize: PAGE_SIZE,
        cursor,
      });
      return {
        ids: page.items.map((item) => item.id),
        total: page.meta.total,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    });

    // 不漏：翻页得到的序列与一次拉取完全一致（顺序也一致）
    expect(walked.ids).toEqual(oneShot.items.map((item) => item.id));
    // 不重
    expect(new Set(walked.ids).size).toBe(walked.ids.length);
    // total 是「与筛选同源、不含游标」的全量口径：每页都一样
    expect(walked.totals.every((total) => total === SEED_COUNT)).toBe(true);
  }, 60_000);

  it('库存流水：同 created_at 多行真实库翻页不漏不重', async () => {
    if (storeId === null || productId === null) {
      console.warn('[skip] 库里没有可用门店/商品，库存流水游标翻页验证跳过');
      return;
    }

    const oneShot = await inventoryReadService.listAdjustments(user, {
      keyword: PROBE_TAG,
      pageSize: 100,
    });
    expect(oneShot.items).toHaveLength(SEED_COUNT);
    expect(oneShot.hasMore).toBe(false);
    expect(oneShot.nextCursor).toBeNull();

    const seededRows = await prisma.inventoryAdjustmentLog.findMany({
      where: { id: { in: adjustmentIds } },
      select: { createdAt: true },
    });
    expect(
      seededRows.filter(
        (row) => row.createdAt.getTime() === SAME_TIME.getTime(),
      ),
    ).toHaveLength(3);

    const walked = await walkPages(async (cursor) => {
      const page = await inventoryReadService.listAdjustments(user, {
        keyword: PROBE_TAG,
        pageSize: PAGE_SIZE,
        cursor,
      });
      return {
        ids: page.items.map((item) => item.id),
        total: page.meta.total,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    });

    expect(walked.ids).toEqual(oneShot.items.map((item) => item.id));
    expect(new Set(walked.ids).size).toBe(walked.ids.length);
    expect(walked.totals.every((total) => total === SEED_COUNT)).toBe(true);
  }, 60_000);

  it('offset 兼容路径仍可用：page=2/pageSize=2 与一次拉取的第 3~4 条一致', async () => {
    if (storeId === null) {
      console.warn('[skip] 库里没有可用门店，offset 兼容路径验证跳过');
      return;
    }

    const oneShot = await membersReadService.list(user, {
      keyword: PROBE_TAG,
      pageSize: 100,
    });
    const paged = await membersReadService.list(user, {
      keyword: PROBE_TAG,
      page: 2,
      pageSize: PAGE_SIZE,
    });

    expect(paged.items.map((item) => item.id)).toEqual(
      oneShot.items.slice(2, 4).map((item) => item.id),
    );
    // 2 + 2 < 5：还有下一页
    expect(paged.hasMore).toBe(true);
    expect(paged.nextCursor).not.toBeNull();
    expect(paged.meta.total).toBe(SEED_COUNT);
  }, 60_000);

  /**
   * 排序键可变性的回归守卫。
   *
   * 历史问题：排序链曾是 `updated_at DESC, id DESC`，而 `updated_at` 由 Prisma
   * `@updatedAt` 自动刷新。翻页期间任何一次会员编辑都会把该行顶到首页：
   * 未读行被顶上首页 → 落在游标之前 → 本次会话再也取不到（漏读）；
   * 已读行被顶上首页 → 与客户端已加载页重复。
   *
   * 排序键换成不可变的 created_at 后，行为必须是：被编辑的行**位置不变**、
   * 全量序列与一次拉取完全一致、无重复。
   */
  it('会员列表：翻页期间被编辑的会员仍不漏不重、位置不变', async () => {
    if (storeId === null) {
      console.warn('[skip] 库里没有可用门店，翻页期间编辑的回归验证跳过');
      return;
    }

    const oneShot = await membersReadService.list(user, {
      keyword: PROBE_TAG,
      pageSize: 100,
    });
    expect(oneShot.items).toHaveLength(SEED_COUNT);

    const firstPage = await membersReadService.list(user, {
      keyword: PROBE_TAG,
      pageSize: PAGE_SIZE,
    });
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await membersReadService.list(user, {
      keyword: PROBE_TAG,
      pageSize: PAGE_SIZE,
      cursor: firstPage.nextCursor ?? undefined,
    });

    // 真实的编辑动作：改备注，updated_at 由 @updatedAt 自动刷新到最新。
    // 响应 DTO 的 id 是字符串，Prisma 主键是 Int，取数时需还原。
    const editedIdRaw = secondPage.items.at(-1)?.id;
    expect(editedIdRaw).toBeDefined();
    const editedId = Number(editedIdRaw);
    const edited = await prisma.member.update({
      where: { id: editedId },
      data: { note: `${PROBE_TAG}-edited` },
    });
    expect(edited.updatedAt.getTime()).toBeGreaterThan(SAME_TIME.getTime());

    // 用翻页前拿到的游标继续走完剩余页
    const rest = await walkPages(async (cursor) => {
      const page = await membersReadService.list(user, {
        keyword: PROBE_TAG,
        pageSize: PAGE_SIZE,
        cursor,
      });
      return {
        ids: page.items.map((item) => item.id),
        total: page.meta.total,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    }, secondPage.nextCursor ?? undefined);

    const walkedIds = [
      ...firstPage.items.map((item) => item.id),
      ...secondPage.items.map((item) => item.id),
      ...rest.ids,
    ];

    // 不漏：被编辑的行没有被顶到游标之前
    expect(walkedIds).toEqual(oneShot.items.map((item) => item.id));
    // 不重
    expect(new Set(walkedIds).size).toBe(walkedIds.length);
    // 位置不变：编辑不会把该行挪到列表首位
    expect(walkedIds.indexOf(String(editedId))).toBeGreaterThan(0);
  }, 60_000);
});
