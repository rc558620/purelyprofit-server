import type { Prisma } from '@prisma/client';
import {
  assertMemberCardUsable,
  releaseMemberCardReservation,
  reserveMemberCardTimes,
  type UsableMemberCardSnapshot,
} from './space-session-card.shared';

/** 次数卡持卡快照（默认 10 次里剩 5 次，单次扣 1 次） */
const buildTimesCard = (overrides: Record<string, unknown> = {}) => ({
  id: 36,
  storeId: 18,
  customerId: 128,
  cardNo: 'MC20260101',
  kind: 'times',
  status: 'active',
  startsAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  remainTimes: 5,
  plan: {
    perUseTimes: 1,
    usableSpaceTypes: [],
    usableWeekdays: [],
    maxGuestPerUse: null,
  },
  ...overrides,
});

describe('space-session-card.shared', () => {
  const mocks = {
    memberCard: {
      findFirst: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
    memberCardTransaction: {
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const tx = mocks as unknown as Prisma.TransactionClient;

  const baseParams = {
    storeId: 18,
    customerId: 128,
    cardId: 36,
    spaceTypeId: 3,
    spaceTypeName: '台球桌',
    guestCount: 2,
    now: new Date('2026-06-07T10:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mocks.memberCardTransaction.create.mockResolvedValue({ id: 501 });
  });

  describe('assertMemberCardUsable', () => {
    it('次数卡校验通过时返回模板配置的单次扣减次数', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(buildTimesCard());

      const snapshot = await assertMemberCardUsable(tx, {
        ...baseParams,
        // 2026-06-07 是周日（ISO 7）
      });

      expect(snapshot).toEqual({
        cardId: 36,
        cardNo: 'MC20260101',
        kind: 'times',
        perUseTimes: 1,
      });
    });

    it('时长卡不扣次（perUseTimes 为 0）', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(
        buildTimesCard({ kind: 'monthly', remainTimes: null }),
      );

      const snapshot = await assertMemberCardUsable(tx, baseParams);

      expect(snapshot.perUseTimes).toBe(0);
    });

    it('卡不属于当前顾客时拒绝开台', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(
        buildTimesCard({ customerId: 999 }),
      );

      await expect(assertMemberCardUsable(tx, baseParams)).rejects.toThrow(
        '该会员卡不属于当前顾客，请重新识别会员',
      );
    });

    it('跨门店的卡按「不存在」处理，避免越权探测', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(
        buildTimesCard({ storeId: 20 }),
      );

      await expect(assertMemberCardUsable(tx, baseParams)).rejects.toThrow(
        '会员卡不存在',
      );
    });

    it('卡已过期（状态或有效期到期）时拒绝开台', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(
        buildTimesCard({ status: 'expired' }),
      );

      await expect(assertMemberCardUsable(tx, baseParams)).rejects.toThrow(
        '该会员卡已过期',
      );
    });

    it('剩余次数不足时在只读阶段就拒绝', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(
        buildTimesCard({
          remainTimes: 0,
          plan: {
            perUseTimes: 1,
            usableSpaceTypes: [],
            usableWeekdays: [],
            maxGuestPerUse: null,
          },
        }),
      );

      await expect(assertMemberCardUsable(tx, baseParams)).rejects.toThrow(
        '该会员卡剩余次数不足',
      );
    });

    it('模板限定了不可用的空间类型时拒绝开台', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(
        buildTimesCard({
          plan: {
            perUseTimes: 1,
            usableSpaceTypes: ['棋牌室'],
            usableWeekdays: [],
            maxGuestPerUse: null,
          },
        }),
      );

      await expect(assertMemberCardUsable(tx, baseParams)).rejects.toThrow(
        '该会员卡不适用于当前空间类型',
      );
    });

    it('usableSpaceTypes 兼容按空间类型名称配置（大小写不敏感）', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(
        buildTimesCard({
          plan: {
            perUseTimes: 1,
            usableSpaceTypes: ['台球桌'],
            usableWeekdays: [],
            maxGuestPerUse: null,
          },
        }),
      );

      await expect(
        assertMemberCardUsable(tx, baseParams),
      ).resolves.toMatchObject({ cardId: 36 });
    });

    it('模板限定了不可用的星期时拒绝开台', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(
        buildTimesCard({
          plan: {
            perUseTimes: 1,
            usableSpaceTypes: [],
            usableWeekdays: [1],
            maxGuestPerUse: null,
          },
        }),
      );

      // 2026-06-07 为周日（ISO 7），模板只允许周一
      await expect(assertMemberCardUsable(tx, baseParams)).rejects.toThrow(
        '该会员卡今日不可用',
      );
    });

    it('开台人数超过模板上限时拒绝开台', async () => {
      mocks.memberCard.findFirst.mockResolvedValue(
        buildTimesCard({
          plan: {
            perUseTimes: 1,
            usableSpaceTypes: [],
            usableWeekdays: [],
            maxGuestPerUse: 1,
          },
        }),
      );

      await expect(assertMemberCardUsable(tx, baseParams)).rejects.toThrow(
        '该会员卡单次最多 1 人使用',
      );
    });
  });

  describe('reserveMemberCardTimes', () => {
    const snapshot: UsableMemberCardSnapshot = {
      cardId: 36,
      cardNo: 'MC20260101',
      kind: 'times',
      perUseTimes: 2,
    };

    it('按条件原子扣减并写 pending reserve 流水', async () => {
      mocks.memberCard.updateManyAndReturn.mockResolvedValue([
        { remainTimes: 3 },
      ]);

      const result = await reserveMemberCardTimes(tx, {
        snapshot,
        sessionId: 9,
        storeId: 18,
        spaceNameSnapshot: 'A01',
        operatorStaffId: 8,
        operatorNameSnapshot: '老板',
      });

      expect(mocks.memberCard.updateManyAndReturn).toHaveBeenCalledWith({
        where: {
          id: 36,
          storeId: 18,
          status: 'active',
          remainTimes: { gte: 2 },
        },
        data: { remainTimes: { decrement: 2 } },
        select: { remainTimes: true },
      });
      // 流水按「更新后的值」反推变更前值，避免预读快照在并发下漂移
      expect(mocks.memberCardTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changeType: 'reserve',
            status: 'pending',
            deltaTimes: -2,
            beforeTimes: 5,
            afterTimes: 3,
            relatedSessionId: 9,
            relatedSpaceNameSnapshot: 'A01',
            operatorType: 'cashier',
          }),
        }),
      );
      expect(result).toMatchObject({
        reserved: true,
        perUseTimes: 2,
        beforeTimes: 5,
        afterTimes: 3,
        transactionId: 501,
      });
    });

    it('条件更新命中 0 行（并发抢占 / 次数不足）时抛冲突且不写流水', async () => {
      mocks.memberCard.updateManyAndReturn.mockResolvedValue([]);

      await expect(
        reserveMemberCardTimes(tx, {
          snapshot,
          sessionId: 9,
          storeId: 18,
          spaceNameSnapshot: 'A01',
        }),
      ).rejects.toThrow('该会员卡剩余次数不足');

      expect(mocks.memberCardTransaction.create).not.toHaveBeenCalled();
    });

    it('时长卡不扣次也不写流水', async () => {
      const result = await reserveMemberCardTimes(tx, {
        snapshot: { ...snapshot, kind: 'monthly', perUseTimes: 0 },
        sessionId: 9,
        storeId: 18,
        spaceNameSnapshot: 'A01',
      });

      expect(result.reserved).toBe(false);
      expect(mocks.memberCard.updateManyAndReturn).not.toHaveBeenCalled();
      expect(mocks.memberCardTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('releaseMemberCardReservation', () => {
    it('把 pending 预扣置 cancelled 并回加次数、追加 release 流水', async () => {
      mocks.memberCardTransaction.findMany.mockResolvedValue([
        {
          id: 501,
          storeId: 18,
          cardId: 36,
          deltaTimes: -2,
          relatedSpaceNameSnapshot: 'A01',
        },
      ]);
      mocks.memberCardTransaction.updateMany.mockResolvedValue({ count: 1 });
      mocks.memberCard.updateManyAndReturn.mockResolvedValue([
        { remainTimes: 5 },
      ]);

      const result = await releaseMemberCardReservation(tx, { sessionId: 9 });

      expect(mocks.memberCardTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: 501, status: 'pending' },
        data: { status: 'cancelled', remark: '开台取消释放预扣' },
      });
      expect(mocks.memberCard.updateManyAndReturn).toHaveBeenCalledWith({
        where: { id: 36 },
        data: { remainTimes: { increment: 2 } },
        select: { remainTimes: true },
      });
      expect(mocks.memberCardTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changeType: 'release',
            status: 'done',
            deltaTimes: 2,
            beforeTimes: 3,
            afterTimes: 5,
            relatedSessionId: 9,
          }),
        }),
      );
      expect(result).toEqual({ releasedTransactions: 1, restoredTimes: 2 });
    });

    it('预扣已被结账确认（条件更新命中 0 行）时幂等跳过，不回加次数', async () => {
      mocks.memberCardTransaction.findMany.mockResolvedValue([
        {
          id: 501,
          storeId: 18,
          cardId: 36,
          deltaTimes: -2,
          relatedSpaceNameSnapshot: 'A01',
        },
      ]);
      mocks.memberCardTransaction.updateMany.mockResolvedValue({ count: 0 });

      const result = await releaseMemberCardReservation(tx, { sessionId: 9 });

      expect(mocks.memberCard.updateManyAndReturn).not.toHaveBeenCalled();
      expect(result).toEqual({ releasedTransactions: 0, restoredTimes: 0 });
    });
  });
});
