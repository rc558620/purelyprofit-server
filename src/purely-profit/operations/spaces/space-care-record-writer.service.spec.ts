import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  resolveCustomerPhone,
  SpaceCareRecordWriterService,
  type WriteCareRecordInput,
} from './space-care-record-writer.service';

/** 构造建档入参（手机号可覆盖） */
const buildInput = (
  overrides: Partial<WriteCareRecordInput> = {},
): WriteCareRecordInput => ({
  storeId: 18,
  sessionId: 9001,
  guestPhone: '13800138000',
  visitAt: 1_761_000_000_000,
  serviceName: '深层清洁',
  amountYuan: 298.5,
  technicianName: '李技师',
  staffId: 7,
  requestId: 'req-1',
  ...overrides,
});

describe('SpaceCareRecordWriterService', () => {
  let service: SpaceCareRecordWriterService;

  const tx = {
    marketingCustomer: { findFirst: jest.fn() },
    careRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const prismaService = {
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaService.$transaction.mockImplementation(
      (fn: (client: typeof tx) => unknown) => fn(tx),
    );
    tx.marketingCustomer.findFirst.mockResolvedValue({ id: 55 });
    tx.careRecord.findUnique.mockResolvedValue(null);
    tx.careRecord.create.mockResolvedValue({ id: 1 });
    tx.careRecord.aggregate.mockResolvedValue({ _max: { seq: null } });
    tx.$queryRaw.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceCareRecordWriterService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<SpaceCareRecordWriterService>(
      SpaceCareRecordWriterService,
    );
  });

  describe('手机号三态', () => {
    it('真实手机号归一化为 11 位纯数字', () => {
      expect(resolveCustomerPhone(' +86 138 0013 8000 ')).toBe('13800138000');
    });

    it('占位手机号（club_wechat:{openid}）被排除', () => {
      expect(resolveCustomerPhone('club_wechat:o6Al43fTTP77c')).toBeNull();
    });

    it('空值 / 非法号码返回 null', () => {
      expect(resolveCustomerPhone(null)).toBeNull();
      expect(resolveCustomerPhone('   ')).toBeNull();
      expect(resolveCustomerPhone('12345')).toBeNull();
    });

    it('无手机号时按正常业务分支跳过，不写库', async () => {
      await expect(
        service.writeAfterSettlement(buildInput({ guestPhone: null })),
      ).resolves.toEqual({ status: 'skipped', reason: 'no-phone' });
      expect(tx.careRecord.create).not.toHaveBeenCalled();
    });

    it('占位手机号按正常业务分支跳过，不写库', async () => {
      await expect(
        service.writeAfterSettlement(
          buildInput({ guestPhone: 'club_wechat:oOPENID' }),
        ),
      ).resolves.toEqual({ status: 'skipped', reason: 'placeholder-phone' });
      expect(tx.careRecord.create).not.toHaveBeenCalled();
    });
  });

  describe('入参防御', () => {
    it('sessionId 缺失/非法时直接判失败，不进库（防 where 被静默忽略）', async () => {
      await expect(
        service.writeAfterSettlement(
          buildInput({ sessionId: undefined as unknown as number }),
        ),
      ).resolves.toEqual({ status: 'failed', reason: 'invalid-session-id' });
      await expect(
        service.writeAfterSettlement(buildInput({ sessionId: 0 })),
      ).resolves.toEqual({ status: 'failed', reason: 'invalid-session-id' });
      expect(tx.careRecord.findUnique).not.toHaveBeenCalled();
      expect(tx.careRecord.create).not.toHaveBeenCalled();
    });
  });

  describe('会员匹配与幂等', () => {
    it('匹配不到会员时不建档（正常业务分支）', async () => {
      tx.marketingCustomer.findFirst.mockResolvedValue(null);

      await expect(service.writeAfterSettlement(buildInput())).resolves.toEqual(
        { status: 'skipped', reason: 'customer-not-found' },
      );
      expect(tx.careRecord.create).not.toHaveBeenCalled();
    });

    it('同场次已建档时跳过（幂等）', async () => {
      tx.careRecord.findUnique.mockResolvedValue({ id: 3 });

      await expect(service.writeAfterSettlement(buildInput())).resolves.toEqual(
        { status: 'skipped', reason: 'already-exists' },
      );
      expect(tx.careRecord.create).not.toHaveBeenCalled();
    });

    it('按门店 + 归一化手机号 + 未软删匹配顾客', async () => {
      await service.writeAfterSettlement(
        buildInput({ guestPhone: '+86 138 0013 8000' }),
      );

      expect(tx.marketingCustomer.findFirst).toHaveBeenCalledWith({
        where: { storeId: 18, phone: '13800138000', deletedAt: null },
        select: { id: true },
      });
    });
  });

  describe('seq 并发自增', () => {
    it('首次建档 seq 从 1 开始', async () => {
      await expect(service.writeAfterSettlement(buildInput())).resolves.toEqual(
        {
          status: 'created',
          customerId: 55,
          seq: 1,
        },
      );
    });

    it('已有记录时取 MAX(seq) + 1', async () => {
      tx.careRecord.aggregate.mockResolvedValue({ _max: { seq: 6 } });

      await expect(service.writeAfterSettlement(buildInput())).resolves.toEqual(
        {
          status: 'created',
          customerId: 55,
          seq: 7,
        },
      );
    });

    it('取号前先锁顾客行，避免首条建档无行可锁', async () => {
      await service.writeAfterSettlement(buildInput());

      // 行锁必须在 aggregate 之前发出，否则并发事务会读到同一个 MAX
      const lockCallOrder = tx.$queryRaw.mock.invocationCallOrder[0];
      const aggregateCallOrder =
        tx.careRecord.aggregate.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(aggregateCallOrder);

      const lockSql = String(tx.$queryRaw.mock.calls[0][0] ?? '');
      expect(lockSql).toContain('marketing_customers');
      expect(lockSql).toContain('FOR UPDATE');
    });
  });

  describe('写入内容', () => {
    it('金额按元入参、分落库，技师与操作人进入快照', async () => {
      await service.writeAfterSettlement(buildInput());

      expect(tx.careRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          storeId: 18,
          customerId: 55,
          seq: 1,
          visitAt: new Date(1_761_000_000_000),
          serviceName: '深层清洁',
          amountCents: 29_850,
          sessionId: 9001,
          technicianName: '李技师',
          createdByStaffId: 7,
        }),
      });
    });

    it('无技师时 technicianName 写 null', async () => {
      await service.writeAfterSettlement(buildInput({ technicianName: null }));

      expect(tx.careRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ technicianName: null }),
      });
    });
  });

  describe('系统异常', () => {
    it('DB 异常时记录 error 日志并返回 failed，不静默吞掉', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      prismaService.$transaction.mockRejectedValue(new Error('deadlock'));

      const outcome = await service.writeAfterSettlement(buildInput());

      expect(outcome).toEqual({ status: 'failed', reason: 'Error' });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const loggedMessage = String(errorSpy.mock.calls[0][0]);
      // 结构化字段齐备，且手机号必须脱敏
      expect(loggedMessage).toContain('CARE_RECORD_WRITE_FAILED');
      expect(loggedMessage).toContain('sessionId=9001');
      expect(loggedMessage).toContain('storeId=18');
      expect(loggedMessage).toContain('phone=138****8000');
      expect(loggedMessage).toContain('requestId=req-1');
      expect(loggedMessage).not.toContain('13800138000');
    });
  });
});
