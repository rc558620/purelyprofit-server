// 提现统一状态机回归用例：profit 与 pulse 共用同一份流转规则与审计字段
import { ConflictException } from '@nestjs/common';
import { PartnerWithdrawalStatus, Prisma } from '@prisma/client';
import {
  WITHDRAWAL_TRANSITIONS,
  assertWithdrawalTransition,
  buildWithdrawalTransitionData,
  updateWithdrawalStatusOrThrow,
} from './withdrawals.state-machine';

const { pending, approved, paid, rejected } = PartnerWithdrawalStatus;

describe('提现统一状态机', () => {
  it('approve 只允许从 pending 进入 approved', () => {
    expect(assertWithdrawalTransition('approve', pending).to).toBe(approved);
    expect(() => assertWithdrawalTransition('approve', approved)).toThrow(
      ConflictException,
    );
  });

  it('reject / pay 允许 pending 与 approved，兼容 pulse 一键打款', () => {
    for (const status of [pending, approved]) {
      expect(assertWithdrawalTransition('reject', status).to).toBe(rejected);
      expect(assertWithdrawalTransition('pay', status).to).toBe(paid);
    }
  });

  it('paid / rejected 为终态，任何动作都不可再流转', () => {
    for (const status of [paid, rejected]) {
      for (const action of ['approve', 'reject', 'pay'] as const) {
        expect(() => assertWithdrawalTransition(action, status)).toThrow(
          ConflictException,
        );
      }
    }
  });

  it('各动作写入对应的操作人审计字段', () => {
    const now = new Date('2026-11-07T10:00:00.000Z');

    expect(
      buildWithdrawalTransitionData({ action: 'approve', now, staffId: 8 }),
    ).toEqual({
      status: approved,
      reviewedAt: now,
      reviewedByStaffId: 8,
      rejectReason: null,
    });
    expect(
      buildWithdrawalTransitionData({ action: 'pay', now, staffId: 9 }),
    ).toEqual({
      status: paid,
      paidAt: now,
      paidByStaffId: 9,
      rejectReason: null,
    });
    expect(
      buildWithdrawalTransitionData({
        action: 'reject',
        now,
        staffId: 10,
        rejectReason: '账号不符',
      }),
    ).toMatchObject({
      status: rejected,
      reviewedByStaffId: 10,
      rejectReason: '账号不符',
    });
  });

  it('原子更新带前置状态条件，影响行数不为 1 时抛状态冲突', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      partnerWithdrawal: { updateMany },
    } as unknown as Prisma.TransactionClient;

    await updateWithdrawalStatusOrThrow(tx, {
      withdrawalId: 12,
      storeId: 18,
      from: WITHDRAWAL_TRANSITIONS.reject.from,
      data: { status: rejected },
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        storeId: 18,
        status: { in: [pending, approved] },
      },
      data: { status: rejected },
    });

    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      updateWithdrawalStatusOrThrow(tx, {
        withdrawalId: 12,
        storeId: 18,
        from: WITHDRAWAL_TRANSITIONS.reject.from,
        data: { status: rejected },
      }),
    ).rejects.toThrow('提现申请状态已变化，请刷新后重试');
  });
});
