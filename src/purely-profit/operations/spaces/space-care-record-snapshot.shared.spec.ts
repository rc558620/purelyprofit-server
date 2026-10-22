// 护理档案快照与展示名兜底：台位费行剔除 / 团购商品名 / 台位费行判定 / 读取链路批量反查
import {
  buildCareRecordSnapshot,
  isTableFeeOnlyServiceName,
  stripTableFeeSegments,
  resolveVoucherProductName,
  resolveVoucherProductNamesBySessionIds,
} from './space-care-record-snapshot.shared';

describe('buildCareRecordSnapshot', () => {
  const buildSource = (
    sessionItems: Array<{ productId: string; productName: string }>,
    totalRevenue = 20,
  ) => ({
    session: { sessionItems, commissionAssignments: null },
    salesOrder: { totalRevenue },
  });

  it('剔除台位费行与抵扣行，只保留真实消费项目', () => {
    const snapshot = buildCareRecordSnapshot(
      buildSource([
        { productId: 'SYS_TIME_BILLING', productName: '台位费 1分钟' },
        { productId: '201', productName: '可乐' },
        { productId: 'SYS_PREPAID_DEDUCTION', productName: '预付抵扣' },
        { productId: '202', productName: '泡沐浴盐护理' },
      ]),
    );
    expect(snapshot.serviceName).toBe('可乐、泡沐浴盐护理');
    expect(snapshot.amountYuan).toBe(20);
  });

  it('团购券开台：券商品名排在展示名最前，台位费行不出现', () => {
    const snapshot = buildCareRecordSnapshot(
      buildSource([
        { productId: 'SYS_TIME_BILLING', productName: '台位费 1分钟' },
      ]),
      '泡沐浴盐护理',
    );
    expect(snapshot.serviceName).toBe('泡沐浴盐护理');
  });

  it('券商品名与消费项目并存时以「、」连接', () => {
    const snapshot = buildCareRecordSnapshot(
      buildSource([{ productId: '201', productName: '可乐' }]),
      '泡沐浴盐护理',
    );
    expect(snapshot.serviceName).toBe('泡沐浴盐护理、可乐');
  });

  it('剔除后无任何项目且无券名时退「场地结账」', () => {
    const snapshot = buildCareRecordSnapshot(
      buildSource([
        { productId: 'SYS_TIME_BILLING', productName: '台位费 1分钟' },
      ]),
    );
    expect(snapshot.serviceName).toBe('场地结账');
  });
});

describe('isTableFeeOnlyServiceName', () => {
  it.each([
    ['', true],
    ['  ', true],
    ['台位费 1分钟', true],
    ['台位费（固定）', true],
    ['台位费（按单价）', true],
    ['台位费 2小时30分钟', true],
    ['可乐', false],
    ['台位费 1分钟、助眠疗愈', false],
    ['深层清洁', false],
  ])('%j → %j', (serviceName, expected) => {
    expect(isTableFeeOnlyServiceName(serviceName)).toBe(expected);
  });
});

describe('stripTableFeeSegments', () => {
  it.each([
    ['台位费 1分钟、助眠疗愈', '助眠疗愈'],
    ['助眠疗愈、台位费 1分钟', '助眠疗愈'],
    ['台位费（固定）、可乐、台位费（按单价）', '可乐'],
    ['台位费 1分钟', ''],
    ['', ''],
    ['手足温熏', '手足温熏'],
  ])('%j → %j', (serviceName, expected) => {
    expect(stripTableFeeSegments(serviceName)).toBe(expected);
  });
});

describe('resolveVoucherProductName', () => {
  it('按券码反查团购商品名', async () => {
    const db = {
      clubVoucherOrder: {
        findFirst: jest.fn().mockResolvedValue({ productName: '泡沐浴盐护理' }),
        findMany: jest.fn(),
      },
    };
    await expect(resolveVoucherProductName(db, 18, ' VC202601 ')).resolves.toBe(
      '泡沐浴盐护理',
    );
    expect(db.clubVoucherOrder.findFirst).toHaveBeenCalledWith({
      where: { storeId: 18, voucherCode: 'VC202601' },
      select: { productName: true },
    });
  });

  it('无券码 / 查不到订单 → null，不触发查询', async () => {
    const db = {
      clubVoucherOrder: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    await expect(resolveVoucherProductName(db, 18, null)).resolves.toBeNull();
    await expect(resolveVoucherProductName(db, 18, '  ')).resolves.toBeNull();
    await expect(resolveVoucherProductName(db, 18, 'NOPE')).resolves.toBeNull();
    expect(db.clubVoucherOrder.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('resolveVoucherProductNamesBySessionIds', () => {
  const buildDb = () => ({
    spaceSession: { findMany: jest.fn() },
    clubVoucherOrder: { findFirst: jest.fn(), findMany: jest.fn() },
  });

  it('sessionId → 券码 → 商品名映射；非本店 / 无券码会话被过滤', async () => {
    const db = buildDb();
    db.spaceSession.findMany.mockResolvedValue([
      { id: 1, prepaidVoucherCode: 'VC1' },
      { id: 2, prepaidVoucherCode: '  ' },
      { id: 3, prepaidVoucherCode: null },
    ]);
    db.clubVoucherOrder.findMany.mockResolvedValue([
      { voucherCode: 'VC1', productName: '泡沐浴盐护理' },
      { voucherCode: null, productName: '无效行' },
    ]);

    await expect(
      resolveVoucherProductNamesBySessionIds(db, 18, [1, 1, 2, 3, undefined]),
    ).resolves.toEqual(new Map([[1, '泡沐浴盐护理']]));
    expect(db.spaceSession.findMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3] }, storeId: 18 },
      select: { id: true, prepaidVoucherCode: true },
    });
    expect(db.clubVoucherOrder.findMany).toHaveBeenCalledWith({
      where: { storeId: 18, voucherCode: { in: ['VC1'] } },
      select: { voucherCode: true, productName: true },
    });
  });

  it('无有效 sessionId / 会话均无券码时不发 clubVoucherOrder 查询', async () => {
    const db = buildDb();
    db.spaceSession.findMany.mockResolvedValue([
      { id: 9, prepaidVoucherCode: null },
    ]);

    await expect(
      resolveVoucherProductNamesBySessionIds(db, 18, []),
    ).resolves.toEqual(new Map());
    expect(db.spaceSession.findMany).not.toHaveBeenCalled();

    await expect(
      resolveVoucherProductNamesBySessionIds(db, 18, [9]),
    ).resolves.toEqual(new Map());
    expect(db.spaceSession.findMany).toHaveBeenCalledTimes(1);
    expect(db.clubVoucherOrder.findMany).not.toHaveBeenCalled();
  });
});
