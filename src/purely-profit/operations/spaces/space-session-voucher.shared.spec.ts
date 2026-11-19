// 团购券读取/开台校验回归：过期与退款占位必须在读取阶段就拦住，不能只依赖状态翻转
import { assertVoucherReadable } from './space-session-voucher.shared';
import {
  VOUCHER_EXPIRED_MESSAGE,
  VOUCHER_REFUNDING_MESSAGE,
} from './space-session-voucher.shared';

const HOUR = 60 * 60 * 1000;

function buildStore(order: Record<string, unknown>): {
  clubVoucherOrder: {
    findFirst: jest.Mock;
    updateMany: jest.Mock;
  };
} {
  return {
    clubVoucherOrder: {
      findFirst: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn(),
    },
  };
}

function buildOrder(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 1,
    customerId: null,
    voucherCode: 'VC-1',
    platform: 'purely-club',
    productId: 10,
    productName: '团购套餐',
    personCount: null,
    guestName: null,
    guestPhone: null,
    guestType: 'member',
    paidAmountFen: 9900,
    status: 'pending',
    usedSessionId: null,
    quantity: 1,
    expiresAt: new Date(Date.now() + HOUR),
    refundNo: null,
    ...overrides,
  };
}

describe('assertVoucherReadable', () => {
  it('有效期已过但状态仍为 pending（未被惰性翻转）时，读取即拒绝', async () => {
    const store = buildStore(
      buildOrder({ expiresAt: new Date(Date.now() - HOUR) }),
    );

    await expect(
      assertVoucherReadable(store as never, 'VC-1', 1),
    ).rejects.toThrow(VOUCHER_EXPIRED_MESSAGE);
  });

  it('退款占位（refundNo 非空）期间禁止读取与开台', async () => {
    const store = buildStore(buildOrder({ refundNo: 'RFVC-1' }));

    await expect(
      assertVoucherReadable(store as never, 'VC-1', 1),
    ).rejects.toThrow(VOUCHER_REFUNDING_MESSAGE);
  });

  it('未过期且未占位的 pending 券可正常读取', async () => {
    const store = buildStore(buildOrder());

    await expect(
      assertVoucherReadable(store as never, 'VC-1', 1),
    ).resolves.toMatchObject({ id: 1, status: 'pending' });
  });
});
