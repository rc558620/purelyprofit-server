import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { resolveCheckoutMemberCard } from './space-session-checkout-card.shared';

const createTransactionClient = (patch: Record<string, unknown>) =>
  patch as unknown as Prisma.TransactionClient;

const createCardRow = (patch: Record<string, unknown> = {}) => ({
  id: 8,
  storeId: 3,
  customerId: 9,
  cardNo: 'CARD-8',
  kind: 'times',
  status: 'active',
  startsAt: new Date('2026-01-01T00:00:00+08:00'),
  expiresAt: new Date('2026-02-01T00:00:00+08:00'),
  remainTimes: 0,
  plan: { perUseTimes: 2 },
  ...patch,
});

describe('resolveCheckoutMemberCard - 确认既有预扣优先于卡当前状态', () => {
  it('开台已预扣的卡到期后仍可结账（不再被有效期校验卡死）', async () => {
    const tx = createTransactionClient({
      memberCard: {
        findFirst: jest
          .fn()
          .mockResolvedValue(createCardRow({ remainTimes: 0 })),
      },
      memberCardTransaction: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
    });

    const snapshot = await resolveCheckoutMemberCard(tx, {
      storeId: 3,
      sessionId: 21,
      customerId: 9,
      selectedCardId: null,
      activeCardId: 8,
      sessionStartedAt: new Date('2026-01-31T20:00:00+08:00'),
      now: new Date('2026-02-02T10:00:00+08:00'),
    });

    expect(snapshot).toEqual({
      cardId: 8,
      cardNo: 'CARD-8',
      kind: 'times',
      perUseTimes: 2,
      hasPendingReserve: true,
    });
  });

  it('无预扣时结账当场选卡仍按当前时刻校验，过期卡拒绝', async () => {
    const tx = createTransactionClient({
      memberCard: {
        findFirst: jest
          .fn()
          .mockResolvedValue(createCardRow({ remainTimes: 4 })),
      },
      memberCardTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      resolveCheckoutMemberCard(tx, {
        storeId: 3,
        sessionId: 21,
        customerId: 9,
        selectedCardId: 8,
        activeCardId: null,
        sessionStartedAt: null,
        now: new Date('2026-02-02T10:00:00+08:00'),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('时长卡开台绑定后到期，按开台时刻复核仍可结账', async () => {
    const tx = createTransactionClient({
      memberCard: {
        findFirst: jest.fn().mockResolvedValue(
          createCardRow({
            kind: 'duration',
            status: 'expired',
            remainTimes: null,
            plan: { perUseTimes: 0 },
          }),
        ),
      },
      memberCardTransaction: { findFirst: jest.fn() },
    });

    const snapshot = await resolveCheckoutMemberCard(tx, {
      storeId: 3,
      sessionId: 21,
      customerId: 9,
      selectedCardId: null,
      activeCardId: 8,
      sessionStartedAt: new Date('2026-01-31T20:00:00+08:00'),
      now: new Date('2026-02-02T10:00:00+08:00'),
    });

    expect(snapshot).toEqual({
      cardId: 8,
      cardNo: 'CARD-8',
      kind: 'duration',
      perUseTimes: 0,
      hasPendingReserve: false,
    });
    // 时长卡不查预扣流水，只按开台时刻复核有效期
    expect(tx.memberCardTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('冻结卡即使有预扣也拒绝（必须先释放预扣）', async () => {
    const tx = createTransactionClient({
      memberCard: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            createCardRow({ status: 'frozen', remainTimes: 0 }),
          ),
      },
      memberCardTransaction: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
    });

    await expect(
      resolveCheckoutMemberCard(tx, {
        storeId: 3,
        sessionId: 21,
        customerId: 9,
        selectedCardId: null,
        activeCardId: 8,
        sessionStartedAt: new Date('2026-01-31T20:00:00+08:00'),
        now: new Date('2026-02-02T10:00:00+08:00'),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
