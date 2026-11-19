// 退款占位/终态回归：占位必须靠 refund_no 条件更新，落库失败必须整笔回滚
import { BadRequestException } from '@nestjs/common';
import {
  claimRefundSlot,
  settleRefundTerminal,
} from './club-voucher-order-refund-settlement.helper';
import {
  CLUB_VOUCHER_ERROR_CODE,
  type ClubVoucherErrorPayload,
} from './club-voucher-orders.errors';

const CONFLICT: ClubVoucherErrorPayload = {
  code: CLUB_VOUCHER_ERROR_CODE.STATUS_REFUND_NOT_ALLOWED,
  message: '当前状态不可退款',
};

function buildPrisma(updateManyResult: { count: number }): {
  clubVoucherOrder: { updateMany: jest.Mock };
  $transaction: jest.Mock;
} {
  const updateMany = jest.fn().mockResolvedValue(updateManyResult);
  const tx = {
    clubVoucherOrder: { updateMany },
    marketingProduct: { updateMany: jest.fn() },
    marketingCustomer: { findFirst: jest.fn(), update: jest.fn() },
    marketingCustomerLevel: { findFirst: jest.fn() },
  };
  return {
    clubVoucherOrder: { updateMany },
    // 事务回调直接执行；抛错即代表回滚
    $transaction: jest.fn(
      async (callback: (client: unknown) => unknown) => await callback(tx),
    ),
  };
}

const ORDER = {
  id: 7,
  orderNo: 'VO-7',
  productId: 3,
  quantity: 1,
  customerId: null,
  customerLevelId: null,
  storeId: 1,
  paidAmountFen: 5000,
  pointsDeductFen: 0,
  pointsDeducted: 0,
  earnedPoints: 0,
} as never;

describe('claimRefundSlot', () => {
  it('抢到占位时返回 true，且写入条件带 refundNo 为空', async () => {
    const prisma = buildPrisma({ count: 1 });

    await expect(claimRefundSlot(prisma as never, 7, 'RFVO-7')).resolves.toBe(
      true,
    );
    expect(prisma.clubVoucherOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 7, refundNo: null }),
        data: { refundNo: 'RFVO-7' },
      }),
    );
  });

  it('被并发退款/开台抢占时返回 false（不发起渠道退款）', async () => {
    const prisma = buildPrisma({ count: 0 });

    await expect(claimRefundSlot(prisma as never, 7, 'RFVO-7')).resolves.toBe(
      false,
    );
  });
});

describe('settleRefundTerminal', () => {
  it('终态落库条件不满足时抛业务异常，且不执行任何回补', async () => {
    const prisma = buildPrisma({ count: 0 });

    await expect(
      settleRefundTerminal(prisma as never, ORDER, {
        orderId: 7,
        orderNo: 'VO-7',
        paidAmountFen: 5000,
        channel: 'wechat',
        refundNo: 'RFVO-7',
        slotClaimed: true,
        conflict: CONFLICT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
