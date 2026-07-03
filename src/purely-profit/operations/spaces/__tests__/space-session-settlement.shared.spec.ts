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
