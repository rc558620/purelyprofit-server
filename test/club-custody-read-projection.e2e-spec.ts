import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { CustodyCodeService } from '../src/shared/custody/custody-code.service';
import { ClubCustodyReadService } from '../src/purely-club/custody/club-custody-read.service';
import { ClubCardContextService } from '../src/purely-club/cards/club-card-context.service';
import { ClubCardQueryService } from '../src/purely-club/cards/club-card-query.service';
import { CLUB_CARD_PLAN_LIST_MAX_LIMIT } from '../src/purely-club/cards/club-cards.constants';
import { CUSTODY_PICKUP_RECORD_LIMIT } from '../src/purely-profit/operations/custody/custody.constants';
import type { ClubCurrentContext } from '../src/purely-club/stores/club-stores.types';

/**
 * 真实数据库 E2E：3-B-8 读投影（select / take）不改变 C 端契约。
 *
 * mock 单测能证明「传了 select」，证明不了「投影里的列刚好够映射用」——
 * 一旦漏 select 了 mapper 会读的列，真实库返回的该字段直接是 undefined，
 * DTO 会静默变成空串 / NaN。这里在 Postgres 上同时断言两件事：
 * 1. 查询确实只取投影里的列（无 orderNo / 会员快照 / 开台规则等无关列）；
 * 2. 列表 / 详情 / 取出流水 / 卡模板列表 / 单张模板的 DTO 字段与金额、
 *    数量口径与改动前完全一致（含 hasMore 多取一条探测与游标翻页）。
 *
 * Redis 侧以 stub 提供会员汇总缓存，强制走 DB 聚合，使汇总断言可复现。
 */
describe('客存 / 卡模板读投影不变契约 (e2e, real database)', () => {
  const envConfig = new ConfigService();

  const configService = {
    get: (key: string): unknown => {
      switch (key) {
        case 'database.url':
          return envConfig.get<string>('DATABASE_URL');
        case 'database.poolMax':
          return 10;
        case 'database.poolMin':
          return 1;
        case 'database.poolIdleTimeoutMs':
          return 30_000;
        case 'database.poolConnectionTimeoutMs':
          return 5_000;
        case 'database.statementTimeoutMs':
          return 10_000;
        case 'database.pgMaxConnections':
          return 100;
        case 'app.slowQueryLogEnabled':
          return false;
        case 'app.slowQueryThresholdMs':
          return 80;
        case 'app.sqlMetricsEnabled':
          return false;
        case 'nodeEnv':
          return 'test';
        default:
          return undefined;
      }
    },
  } as ConfigService;

  /** 会员汇总缓存 stub：恒未命中，保证汇总每次都走真实聚合 */
  const custodyCodeStub = {
    readMemberSummary: (): Promise<unknown> => Promise.resolve(null),
    writeMemberSummary: (): Promise<void> => Promise.resolve(),
  };

  let prisma: PrismaService;
  let moduleFixture: TestingModule;
  let readService: ClubCustodyReadService;
  let cardContextService: ClubCardContextService;
  let cardQueryService: ClubCardQueryService;

  const suffix = `${Date.now()}`;
  const phone = `138${suffix.slice(-8)}`;
  const DAY_MS = 24 * 60 * 60 * 1000;

  let storeId = 0;
  let storeName = '';
  let context: ClubCurrentContext;
  let createdUserIds: number[] = [];

  // 存单时间轴（createdAt 显式指定，避免同毫秒写入导致列表顺序不可断言）
  const t0 = new Date(Date.now() - 10 * DAY_MS);
  const t1 = new Date(Date.now() - 9 * DAY_MS);
  const t2 = new Date(Date.now() - 8 * DAY_MS);
  const t3 = new Date(Date.now() - 7 * DAY_MS);
  const t4 = new Date(Date.now() - 6 * DAY_MS);

  const orderIds: Record<string, number> = {};
  const planIds: Record<string, number> = {};
  let pickedList: { id: number; qty: number; pickedAt: Date }[] = [];

  const buildOrderNo = (tag: string): string =>
    `COE2E${tag}${suffix.slice(-8)}`;

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        { provide: CustodyCodeService, useValue: custodyCodeStub },
        ClubCustodyReadService,
        ClubCardContextService,
        ClubCardQueryService,
      ],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    readService = moduleFixture.get(ClubCustodyReadService);
    cardContextService = moduleFixture.get(ClubCardContextService);
    cardQueryService = moduleFixture.get(ClubCardQueryService);

    const owner = await prisma.user.create({
      data: {
        email: `e2e-projection-${suffix}@test.local`,
        password: 'not-used',
        name: '投影测试老板',
      },
    });
    createdUserIds.push(owner.id);

    const store = await prisma.store.create({
      data: {
        name: `E2E读投影店${suffix}`,
        ownerId: owner.id,
        businessMode: 'general',
      },
    });
    storeId = store.id;
    storeName = store.name;

    // 会员定位口径是「门店 + 手机号」（resolveCustodyMemberId），必须建 Member
    const member = await prisma.member.create({
      data: { storeId, name: '投影测试会员', phone },
    });

    context = {
      store: {
        id: store.id,
        name: store.name,
        address: store.address,
        businessMode: store.businessMode,
        memberCareEnabled: store.memberCareEnabled,
        createdAt: store.createdAt,
        updatedAt: store.updatedAt,
      },
      user: {
        id: owner.id,
        email: owner.email,
        phone,
        name: owner.name,
        createdAt: owner.createdAt,
        updatedAt: owner.updatedAt,
        lastActiveAt: null,
        currentMembership: null,
      },
    };

    const baseOrder = {
      storeId,
      memberId: member.id,
      memberNameSnapshot: '投影测试会员',
      memberPhoneSnapshot: phone,
      unit: '瓶',
    };

    const storedA = await prisma.custodyOrder.create({
      data: {
        ...baseOrder,
        orderNo: buildOrderNo('A'),
        productName: '投影测试商品A',
        specName: '500ml',
        totalQty: 10,
        remainingQty: 4,
        location: 'A-01',
        storedAt: t0,
        expireAt: null,
        status: 'stored',
        note: '冷藏',
        image: 'https://cdn.test/a.png',
        createdAt: t0,
      },
    });
    const storedB = await prisma.custodyOrder.create({
      data: {
        ...baseOrder,
        orderNo: buildOrderNo('B'),
        productName: '投影测试商品B',
        specName: null,
        totalQty: 6,
        remainingQty: 6,
        location: null,
        storedAt: t1,
        // 1 天后到期：落在 3 天临期窗口内，用于断言 summary.expiringCount
        expireAt: new Date(Date.now() + DAY_MS),
        status: 'stored',
        note: null,
        image: null,
        createdAt: t1,
      },
    });
    const finishedC = await prisma.custodyOrder.create({
      data: {
        ...baseOrder,
        orderNo: buildOrderNo('C'),
        productName: '投影测试商品C',
        totalQty: 2,
        remainingQty: 0,
        storedAt: t2,
        status: 'finished',
        createdAt: t2,
      },
    });
    const draftD = await prisma.custodyOrder.create({
      data: {
        ...baseOrder,
        orderNo: buildOrderNo('D'),
        productName: '投影测试草稿',
        totalQty: 1,
        remainingQty: 1,
        storedAt: t3,
        status: 'draft',
        createdAt: t3,
      },
    });
    const voidE = await prisma.custodyOrder.create({
      data: {
        ...baseOrder,
        orderNo: buildOrderNo('E'),
        productName: '投影测试作废',
        totalQty: 1,
        remainingQty: 1,
        storedAt: t4,
        status: 'void',
        voidedAt: t4,
        voidReason: '测试作废',
        createdAt: t4,
      },
    });

    orderIds.A = storedA.id;
    orderIds.B = storedB.id;
    orderIds.C = finishedC.id;
    orderIds.D = draftD.id;
    orderIds.E = voidE.id;

    const firstPickup = await prisma.custodyPickup.create({
      data: {
        custodyOrderId: storedA.id,
        storeId,
        qty: 3,
        pickedAt: new Date(t0.getTime() + 60 * 60 * 1000),
      },
    });
    const secondPickup = await prisma.custodyPickup.create({
      data: {
        custodyOrderId: storedA.id,
        storeId,
        qty: 3,
        pickedAt: new Date(t0.getTime() + 2 * 60 * 60 * 1000),
      },
    });
    // 软删流水：既不能出现在详情，也不能计入 summary.pickedCount
    await prisma.custodyPickup.create({
      data: {
        custodyOrderId: storedA.id,
        storeId,
        qty: 100,
        pickedAt: new Date(t0.getTime() + 3 * 60 * 60 * 1000),
        deletedAt: new Date(),
      },
    });
    pickedList = [firstPickup, secondPickup];

    const timesPlan = await prisma.memberCardPlan.create({
      data: {
        storeId,
        name: '投影次卡10次',
        kind: 'times',
        price: 9900,
        originalPrice: 12900,
        validDays: 180,
        totalTimes: 10,
        purchaseLimit: 1,
      },
    });
    const monthlyPlan = await prisma.memberCardPlan.create({
      data: {
        storeId,
        name: '投影月卡',
        kind: 'monthly',
        price: 19900,
        originalPrice: 19900,
        validDays: 30,
        totalTimes: null,
        purchaseLimit: 2,
      },
    });
    const yearlyPlan = await prisma.memberCardPlan.create({
      data: {
        storeId,
        name: '投影年卡',
        kind: 'yearly',
        price: 99900,
        originalPrice: null,
        validDays: 365,
        totalTimes: null,
      },
    });
    // 下架 / 软删模板不得出现在购卡页
    await prisma.memberCardPlan.create({
      data: {
        storeId,
        name: '投影下架卡',
        kind: 'monthly',
        price: 100,
        validDays: 30,
        isActive: false,
      },
    });
    await prisma.memberCardPlan.create({
      data: {
        storeId,
        name: '投影已删卡',
        kind: 'monthly',
        price: 50,
        validDays: 30,
        deletedAt: new Date(),
      },
    });

    planIds.times = timesPlan.id;
    planIds.monthly = monthlyPlan.id;
    planIds.yearly = yearlyPlan.id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.custodyPickup.deleteMany({ where: { storeId } });
    await prisma.custodyOrder.deleteMany({ where: { storeId } });
    await prisma.memberCardPlan.deleteMany({ where: { storeId } });
    await prisma.member.deleteMany({ where: { storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds = [];
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  const listParams = (extra?: { limit?: number; cursor?: string }) => ({
    status: 'all',
    expiring: false,
    keyword: '',
    limit: 10,
    ...extra,
  });

  it('列表：只取会员视角列，DTO 字段与汇总口径不变', async () => {
    const spy = jest.spyOn(prisma.custodyOrder, 'findMany');

    const result = await readService.listOrders(context, listParams());

    // 1) 投影：列集合必须与 mapper 读取字段完全一致
    const select = spy.mock.calls[0]![0]!.select as Record<string, true>;
    expect(Object.keys(select).sort()).toEqual(
      [
        'createdAt',
        'expireAt',
        'id',
        'image',
        'location',
        'note',
        'productName',
        'remainingQty',
        'specName',
        'status',
        'storeId',
        'storedAt',
        'totalQty',
        'unit',
      ].sort(),
    );
    expect(select).not.toHaveProperty('orderNo');
    expect(select).not.toHaveProperty('memberNameSnapshot');
    expect(select).not.toHaveProperty('memberPhoneSnapshot');
    expect(select).not.toHaveProperty('stockMode');
    expect(select).not.toHaveProperty('voidedAt');
    expect(select).not.toHaveProperty('createdByNameSnapshot');
    // 多取一条做 hasMore 探测的语义保持不变
    expect(spy.mock.calls[0]![0]!.take).toBe(11);

    // 2) 可见范围不变：void 与 draft 被剔除，按 createdAt 倒序
    expect(result.items.map((item) => item.productName)).toEqual([
      '投影测试商品C',
      '投影测试商品B',
      '投影测试商品A',
    ]);
    expect(result.nextCursor).toBeNull();

    // 3) 汇总口径不变（stored / 临期 / 待确认 / 已取件）
    expect(result.summary).toEqual({
      storedCount: 2,
      expiringCount: 1,
      pendingCount: 1,
      pickedCount: 6,
    });

    // 4) 字段值逐项不变，含 null → 空串兜底
    expect(result.items[2]).toEqual({
      id: String(orderIds.A),
      storeId,
      storeName,
      productName: '投影测试商品A',
      specName: '500ml',
      unit: '瓶',
      totalQty: 10,
      remainingQty: 4,
      location: 'A-01',
      storedAt: t0.toISOString(),
      expireAt: '',
      status: 'stored',
      remark: '冷藏',
      image: 'https://cdn.test/a.png',
    });
    expect(result.items[1]).toMatchObject({
      id: String(orderIds.B),
      specName: '',
      location: '',
      remark: '',
      image: '',
      status: 'stored',
    });
    expect(result.items[0]).toMatchObject({
      id: String(orderIds.C),
      status: 'finished',
    });
  });

  it('列表：多取一条探测 hasMore，游标翻页结果不变', async () => {
    const firstPage = await readService.listOrders(
      context,
      listParams({ limit: 2 }),
    );

    expect(firstPage.items.map((item) => item.productName)).toEqual([
      '投影测试商品C',
      '投影测试商品B',
    ]);
    // 游标仍是 (createdAt, id) 复合键，指向当页最后一条
    expect(firstPage.nextCursor).toBe(`${t1.getTime()}_${orderIds.B}`);

    const secondPage = await readService.listOrders(
      context,
      listParams({ limit: 2, cursor: firstPage.nextCursor! }),
    );
    expect(secondPage.items.map((item) => item.productName)).toEqual([
      '投影测试商品A',
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('列表：待确认入口只透出 draft，作废单永不出现', async () => {
    const draftOnly = await readService.listOrders(context, {
      ...listParams(),
      status: 'draft',
    });

    expect(draftOnly.items.map((item) => item.id)).toEqual([
      String(orderIds.D),
    ]);
    expect(draftOnly.items[0]!.status).toBe('draft');
    expect(draftOnly.items.map((item) => item.id)).not.toContain(
      String(orderIds.E),
    );
  });

  it('详情：存单 + 取出流水投影，软删流水不出现', async () => {
    const orderSpy = jest.spyOn(prisma.custodyOrder, 'findFirst');
    const pickupSpy = jest.spyOn(prisma.custodyPickup, 'findMany');

    const detail = await readService.getOrderDetail(context, orderIds.A);

    const orderSelect = orderSpy.mock.calls[0]![0]!.select as Record<
      string,
      true
    >;
    expect(orderSelect).not.toHaveProperty('orderNo');
    expect(orderSelect).not.toHaveProperty('sourceOrderId');

    const pickupSelect = pickupSpy.mock.calls[0]![0]!.select as Record<
      string,
      true
    >;
    expect(Object.keys(pickupSelect).sort()).toEqual([
      'custodyOrderId',
      'id',
      'pickedAt',
      'qty',
    ]);
    expect(pickupSelect).not.toHaveProperty('operatorStaffId');
    expect(pickupSelect).not.toHaveProperty('idempotencyKey');
    expect(pickupSpy.mock.calls[0]![0]!.take).toBe(CUSTODY_PICKUP_RECORD_LIMIT);

    expect(detail.order.id).toBe(String(orderIds.A));
    expect(detail.order.remainingQty).toBe(4);
    // 时间倒序：后取出的在前
    expect(detail.pickupRecords).toEqual([
      {
        id: String(pickedList[1]!.id),
        custodyOrderId: String(orderIds.A),
        qty: 3,
        pickedAt: pickedList[1]!.pickedAt.toISOString(),
        storeName,
      },
      {
        id: String(pickedList[0]!.id),
        custodyOrderId: String(orderIds.A),
        qty: 3,
        pickedAt: pickedList[0]!.pickedAt.toISOString(),
        storeName,
      },
    ]);
  });

  it('购卡页：档位列表加 take 上限、只取展示列，视图字段不变', async () => {
    const spy = jest.spyOn(prisma.memberCardPlan, 'findMany');

    const plans = await cardContextService.listAvailablePlans({ storeId });

    const args = spy.mock.calls[0]![0]!;
    expect(args.take).toBe(CLUB_CARD_PLAN_LIST_MAX_LIMIT);
    expect(Object.keys(args.select as Record<string, true>).sort()).toEqual([
      'id',
      'kind',
      'name',
      'originalPrice',
      'price',
      'totalTimes',
      'validDays',
    ]);
    expect(args.select).not.toHaveProperty('usableSpaceTypes');
    expect(args.select).not.toHaveProperty('perUseTimes');

    // 排序仍在 SQL 侧：价格升序，下架 / 软删模板不参与
    expect(plans.map((plan) => plan.name)).toEqual([
      '投影次卡10次',
      '投影月卡',
      '投影年卡',
    ]);

    // C 端视图契约（含划线价仅在高于售价时下发）
    const view = await cardQueryService.listPlans(context);
    expect(view.items).toEqual([
      {
        id: String(planIds.times),
        kind: 'times',
        name: '投影次卡10次',
        price: 99,
        originalPrice: 129,
        validDays: 180,
        totalTimes: 10,
        validityText: '10 次 · 180 天内有效',
        storeNames: [storeName],
      },
      {
        id: String(planIds.monthly),
        kind: 'monthly',
        name: '投影月卡',
        price: 199,
        validDays: 30,
        totalTimes: null,
        validityText: '30 天',
        storeNames: [storeName],
      },
      {
        id: String(planIds.yearly),
        kind: 'yearly',
        name: '投影年卡',
        price: 999,
        validDays: 365,
        totalTimes: null,
        validityText: '365 天',
        storeNames: [storeName],
      },
    ]);
  });

  it('单张模板：只取下单所需列，限购与单价口径不变', async () => {
    const spy = jest.spyOn(prisma.memberCardPlan, 'findFirst');

    const resolved = await cardContextService.resolvePlan(
      context,
      planIds.monthly!,
    );

    expect(spy.mock.calls[0]![0]!.select).toEqual({
      id: true,
      kind: true,
      name: true,
      price: true,
      purchaseLimit: true,
    });
    expect(resolved.plan).toEqual({
      id: planIds.monthly,
      kind: 'monthly',
      name: '投影月卡',
      price: 19900,
      purchaseLimit: 2,
    });
    expect(resolved.storeName).toBe(storeName);
  });

  it('单张模板：下架 / 软删模板仍按原口径抛 404', async () => {
    const inactive = await prisma.memberCardPlan.findFirstOrThrow({
      where: { storeId, name: '投影下架卡' },
      select: { id: true },
    });

    await expect(
      cardContextService.resolvePlan(context, inactive.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
