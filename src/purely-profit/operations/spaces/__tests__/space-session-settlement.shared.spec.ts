import { Money } from '../../../../shared/money.utils';
import { buildSpaceSessionSettlement } from '../space-session-settlement.shared';
import type {
  SpaceSessionSettlementRecord,
  SpaceSessionItemRecord,
  SpaceSessionRenewRecord,
} from '../space-sessions.types';

// ---------- helpers ----------

const BASE_TIME = new Date('2024-06-01T10:00:00.000Z');

const makeSession = (
  overrides: Partial<SpaceSessionSettlementRecord> = {},
): SpaceSessionSettlementRecord =>
  ({
    id: 1,
    storeId: 1,
    spaceId: 1,
    space: {
      id: 1,
      name: 'A台',
      enableDirtyRoom: false,
      type: { name: '台球台' },
    },
    reservationId: null,
    guestName: null,
    guestPhone: null,
    guestCount: null,
    startTime: BASE_TIME,
    endTime: null,
    billingMode: 'timed' as const,
    hourlyRate: 6800, // 68元/时 → DB存6800分
    timeCost: null,
    countdownMinutes: null,
    autoCheckout: null,
    prepaidPaymentMethod: null,
    prepaidCustomerPaymentMethod: null,
    prepaidSettlementChannel: null,
    prepaidGrouponCode: null,
    prepaidGrouponPlatform: null,
    prepaidVoucherCode: null,
    prepaidVoucherPlatform: null,
    prepaidNote: null,
    prepaidAmount: null,
    prepaidVoucherFaceAmount: null,
    sessionItems: [],
    itemsCost: 0,
    sessionRenewRecords: [],
    status: 'active' as const,
    saleOrderId: null,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  }) as unknown as SpaceSessionSettlementRecord;

const NO_ITEMS: SpaceSessionItemRecord[] = [];
const NO_RENEW: SpaceSessionRenewRecord[] = [];

// ---------- timed 模式 ----------

describe('buildSpaceSessionSettlement — timed 模式', () => {
  it('1 分钟 → 按 1 分钟计费，金额向上取整到分', () => {
    const checkoutAt = BASE_TIME.getTime() + 30 * 1000; // 30秒
    const result = buildSpaceSessionSettlement({
      session: makeSession(),
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords: NO_RENEW,
    });
    // 1分钟 / 60 * 68 = 1.1333... 向上取整到分 → 1.14
    expect(result.timeCost).toBe(1.14);
    expect(result.durationMinutes).toBe(1);
  });

  it('60 分钟 → 刚好1小时，金额 = hourlyRate', () => {
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const result = buildSpaceSessionSettlement({
      session: makeSession(),
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords: NO_RENEW,
    });
    expect(result.timeCost).toBe(68);
    expect(result.totalAmount).toBe(68);
  });

  it('90 分钟 → 1.5小时 × 68 = 102', () => {
    const checkoutAt = BASE_TIME.getTime() + 90 * 60 * 1000;
    const result = buildSpaceSessionSettlement({
      session: makeSession(),
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords: NO_RENEW,
    });
    expect(result.timeCost).toBe(102);
  });

  it('59 分钟 → 向上取整为 59 分钟', () => {
    const checkoutAt = BASE_TIME.getTime() + 59 * 60 * 1000;
    const result = buildSpaceSessionSettlement({
      session: makeSession(),
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords: NO_RENEW,
    });
    expect(result.durationMinutes).toBe(59);
  });

  it('61 分钟 → 向上取整为 61 分钟', () => {
    const checkoutAt = BASE_TIME.getTime() + 61 * 60 * 1000;
    const result = buildSpaceSessionSettlement({
      session: makeSession(),
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords: NO_RENEW,
    });
    expect(result.durationMinutes).toBe(61);
  });
});

// ---------- items 模式（无台位费） ----------

describe('buildSpaceSessionSettlement — items 模式', () => {
  it('items 模式不收台位费', () => {
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const items: SpaceSessionItemRecord[] = [
      { productId: 'P1', productName: '可乐', categoryName: '饮品', salePrice: 10, profit: 5, quantity: 2, lineTotal: 20 },
    ];
    const result = buildSpaceSessionSettlement({
      session: makeSession({ billingMode: 'items' as const, hourlyRate: null }),
      checkoutAt,
      payload: {},
      items,
      renewRecords: NO_RENEW,
    });
    expect(result.timeCost).toBe(0);
    expect(result.itemsCost).toBe(20);
    expect(result.totalAmount).toBe(20);
  });
});

// ---------- 续费抵扣 ----------

describe('buildSpaceSessionSettlement — 续费抵扣', () => {
  it('timed 模式有续费记录时应抵扣', () => {
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const renewRecords: SpaceSessionRenewRecord[] = [
      { id: 'rn_1', amount: 30, addedMinutes: 26, paymentMethod: 'cash' as const, renewedAt: Date.now() },
    ];
    const result = buildSpaceSessionSettlement({
      session: makeSession(),
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords,
    });
    expect(result.timeCost).toBe(68);
    expect(result.renewDeduction).toBe(30);
    expect(result.totalAmount).toBe(38);
  });

  it('mixed 模式有续费记录时应抵扣', () => {
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const items: SpaceSessionItemRecord[] = [
      { productId: 'P1', productName: '可乐', categoryName: '饮品', salePrice: 10, profit: 5, quantity: 2, lineTotal: 20 },
    ];
    const renewRecords: SpaceSessionRenewRecord[] = [
      { id: 'rn_1', amount: 30, addedMinutes: 26, paymentMethod: 'cash' as const, renewedAt: Date.now() },
    ];
    const result = buildSpaceSessionSettlement({
      session: makeSession({ billingMode: 'mixed' as const }),
      checkoutAt,
      payload: {},
      items,
      renewRecords,
    });
    expect(result.timeCost).toBe(68);
    expect(result.itemsCost).toBe(20);
    expect(result.renewDeduction).toBe(30);
    expect(result.totalAmount).toBe(58); // 68 + 20 - 30 = 58
  });
});

// ---------- 预付款 ----------

describe('buildSpaceSessionSettlement — 预付款', () => {
  it('有预付金额时应抵扣', () => {
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const result = buildSpaceSessionSettlement({
      session: makeSession({ prepaidAmount: 2000 }), // 20元 → DB存2000分
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords: NO_RENEW,
    });
    expect(result.prepaidDeduction).toBe(20);
    expect(result.totalAmount).toBe(48);
  });

  it('items 模式也应扣减预付', () => {
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const items: SpaceSessionItemRecord[] = [
      { productId: 'P1', productName: '可乐', categoryName: '饮品', salePrice: 10, profit: 5, quantity: 1, lineTotal: 10 },
    ];
    const result = buildSpaceSessionSettlement({
      session: makeSession({
        billingMode: 'items' as const,
        hourlyRate: null,
        prepaidAmount: 2000,
      }),
      checkoutAt,
      payload: {},
      items,
      renewRecords: NO_RENEW,
    });
    expect(result.prepaidDeduction).toBe(20);
    expect(result.totalAmount).toBe(-10); // 10 - 20 = -10
  });
});

// ---------- 混合消费 ----------

describe('buildSpaceSessionSettlement — 混合消费', () => {
  it('台位费 + 商品 + 续费抵扣 + 预付款', () => {
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const items: SpaceSessionItemRecord[] = [
      { productId: 'P1', productName: '可乐', categoryName: '饮品', salePrice: 10, profit: 5, quantity: 2, lineTotal: 20 },
    ];
    const renewRecords: SpaceSessionRenewRecord[] = [
      { id: 'rn_1', amount: 30, addedMinutes: 26, paymentMethod: 'cash' as const, renewedAt: Date.now() },
    ];
    const result = buildSpaceSessionSettlement({
      session: makeSession({ prepaidAmount: 1000 }), // 10元
      checkoutAt,
      payload: {},
      items,
      renewRecords,
    });
    expect(result.timeCost).toBe(68);
    expect(result.itemsCost).toBe(20);
    expect(result.renewDeduction).toBe(30);
    expect(result.prepaidDeduction).toBe(10);
    expect(result.totalAmount).toBe(48);
  });
});

// ---------- countdown + unit_price 模式 ----------

describe('buildSpaceSessionSettlement — countdown + unit_price 模式', () => {
  it('unit_price 模式 → 台位费 = hourlyRate（固定）', () => {
    const checkoutAt = BASE_TIME.getTime() + 90 * 60 * 1000;
    const result = buildSpaceSessionSettlement({
      session: makeSession({ billingMode: 'countdown' as const, countdownMinutes: 60 }),
      checkoutAt,
      payload: { timeFeeMode: 'unit_price' },
      items: NO_ITEMS,
      renewRecords: NO_RENEW,
    });
    expect(result.timeCost).toBe(68);
  });

  it('countdown + timed 模式 → 按实际时间计费', () => {
    const checkoutAt = BASE_TIME.getTime() + 90 * 60 * 1000;
    const result = buildSpaceSessionSettlement({
      session: makeSession({ billingMode: 'countdown' as const, countdownMinutes: 60 }),
      checkoutAt,
      payload: { timeFeeMode: 'timed' },
      items: NO_ITEMS,
      renewRecords: NO_RENEW,
    });
    expect(result.timeCost).toBe(102);
  });
});

// ---------- lineTotal 字段 ----------

describe('buildSpaceSessionSettlement — lineTotal 字段', () => {
  it('商品行应有 lineTotal = salePrice × quantity', () => {
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const items: SpaceSessionItemRecord[] = [
      { productId: 'P1', productName: '可乐', categoryName: '饮品', salePrice: 10, profit: 5, quantity: 3, lineTotal: 30 },
    ];
    const result = buildSpaceSessionSettlement({
      session: makeSession(),
      checkoutAt,
      payload: {},
      items,
      renewRecords: NO_RENEW,
    });
    const timeItem = result.orderItems.find((i) => i.productId === 'SYS_TIME_BILLING');
    expect(timeItem?.lineTotal).toBe(68);
    const productItem = result.orderItems.find((i) => i.productId === 'P1');
    expect(productItem?.lineTotal).toBe(30);
  });
});

// ---------- Money.multiplyCeilToCent ----------

describe('Money.multiplyCeilToCent', () => {
  it('1.1333... 小时 × 6800分 = 向上取整到分', () => {
    const hourlyRate = Money.fromDbCents(6800); // 68元
    const result = hourlyRate.multiplyCeilToCent(1 / 60); // 1分钟
    // 6800 * (1/60) = 113.333... → ceil → 114 分 = 1.14 元
    expect(result.toOutputYuan()).toBe(1.14);
  });

  it('1.5 小时 × 6800分 = 10200分 = 102元', () => {
    const hourlyRate = Money.fromDbCents(6800);
    const result = hourlyRate.multiplyCeilToCent(1.5);
    expect(result.toOutputYuan()).toBe(102);
  });
});

// ---------- Money.calcWholeUnitsFloor ----------

describe('Money.calcWholeUnitsFloor', () => {
  it('30元 / 68元每时 × 60分钟 = 26.47... → 向下取整 26', () => {
    const amount = Money.fromInputYuan(30);
    const hourlyRate = Money.fromDbCents(6800);
    expect(amount.calcWholeUnitsFloor(hourlyRate, 60)).toBe(26);
  });

  it('68元 / 68元每时 × 60分钟 = 60', () => {
    const amount = Money.fromInputYuan(68);
    const hourlyRate = Money.fromDbCents(6800);
    expect(amount.calcWholeUnitsFloor(hourlyRate, 60)).toBe(60);
  });

  it('金额不足1分钟 → 0', () => {
    const amount = Money.fromInputYuan(0.5);
    const hourlyRate = Money.fromDbCents(6800);
    expect(amount.calcWholeUnitsFloor(hourlyRate, 60)).toBe(0);
  });

  it('单价为0 → 0', () => {
    const amount = Money.fromInputYuan(30);
    const hourlyRate = Money.zero();
    expect(amount.calcWholeUnitsFloor(hourlyRate, 60)).toBe(0);
  });
});

// ---------- BUG-1 回归：团购续费两池独立，不重复抵扣 ----------

describe('BUG-1 回归：团购续费两池独立', () => {
  it('Flow A: 开台无预付 + 团购续费 → 仅 renewDeduction，无 prepaidDeduction', () => {
    // 场景：开台无预付，团购续费 amount=80, voucherFaceAmount=100
    // 修复后 session.prepaid* 保持 null，结算只产生 renewDeduction
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000; // 1小时
    const renewRecords: SpaceSessionRenewRecord[] = [
      {
        id: 'rn_1',
        amount: 80,
        addedMinutes: 88,
        paymentMethod: 'groupon_voucher' as const,
        voucherFaceAmount: 100,
        grouponCode: 'MT001',
        grouponPlatform: '美团',
        renewedAt: Date.now(),
      },
    ];
    const result = buildSpaceSessionSettlement({
      session: makeSession({
        // 开台无预付 — 所有 prepaid* 为 null
        prepaidAmount: null,
        prepaidVoucherFaceAmount: null,
      }),
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords,
    });
    // 台位费 68元/时 × 1小时 = 68
    expect(result.timeCost).toBe(68);
    // renewDeduction = max(80, 100) = 100
    expect(result.renewDeduction).toBe(100);
    // prepaidDeduction = max(0, 0) = 0（无预付，不重复抵扣）
    expect(result.prepaidDeduction).toBe(0);
    // totalAmount = 68 - 100 - 0 = -32
    expect(result.totalAmount).toBe(-32);
  });

  it('Flow B: 开台团购预付 + 团购续费 → 两池独立计算，不互相覆盖', () => {
    // 场景：开台预付 voucherFaceAmount=200，团购续费 voucherFaceAmount=100
    // 修复后 session.prepaidVoucherFaceAmount=200 不被续费覆盖
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const renewRecords: SpaceSessionRenewRecord[] = [
      {
        id: 'rn_1',
        amount: 80,
        addedMinutes: 88,
        paymentMethod: 'groupon_voucher' as const,
        voucherFaceAmount: 100,
        grouponCode: 'MT002',
        grouponPlatform: '美团',
        renewedAt: Date.now(),
      },
    ];
    const result = buildSpaceSessionSettlement({
      session: makeSession({
        // 开台预付团购券面 200元 = 20000分
        prepaidAmount: 16000, // 实付 160元
        prepaidVoucherFaceAmount: 20000, // 券面 200元
      }),
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords,
    });
    // 台位费 68元
    expect(result.timeCost).toBe(68);
    // renewDeduction = max(80, 100) = 100
    expect(result.renewDeduction).toBe(100);
    // prepaidDeduction = max(160, 200) = 200（开台预付不被覆盖）
    expect(result.prepaidDeduction).toBe(200);
    // totalAmount = 68 - 100 - 200 = -232
    expect(result.totalAmount).toBe(-232);
  });

  it('多次团购续费 → renewDeduction 累加所有续费记录', () => {
    const checkoutAt = BASE_TIME.getTime() + 60 * 60 * 1000;
    const renewRecords: SpaceSessionRenewRecord[] = [
      {
        id: 'rn_1',
        amount: 80,
        addedMinutes: 88,
        paymentMethod: 'groupon_voucher' as const,
        voucherFaceAmount: 100,
        renewedAt: Date.now(),
      },
      {
        id: 'rn_2',
        amount: 50,
        addedMinutes: 44,
        paymentMethod: 'cash' as const,
        renewedAt: Date.now(),
      },
    ];
    const result = buildSpaceSessionSettlement({
      session: makeSession(),
      checkoutAt,
      payload: {},
      items: NO_ITEMS,
      renewRecords,
    });
    // renewDeduction = max(80,100) + 50 = 150
    expect(result.renewDeduction).toBe(150);
    expect(result.prepaidDeduction).toBe(0);
    // totalAmount = 68 - 150 = -82
    expect(result.totalAmount).toBe(-82);
  });
});
