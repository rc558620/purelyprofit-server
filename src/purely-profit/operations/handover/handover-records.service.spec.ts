import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeShiftType,
  HandoverMode,
  HandoverStatus,
  Prisma,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { HandoverRecordsService } from './handover-records.service';
import {
  createHandoverPrismaMock,
  createManagerUser,
  createMockCandidates,
  createMockRecord,
  createOwnerUser,
  createStoreSubAccountServiceMock,
  createSubAccountUser,
} from './hover.spec-helpers';

describe('HandoverRecordsService', () => {
  let service: HandoverRecordsService;

  const prismaService = createHandoverPrismaMock();
  const storeSubAccountService = createStoreSubAccountServiceMock();

  const ownerUser = createOwnerUser();
  const subAccountUser = createSubAccountUser();
  const managerUser = createManagerUser();
  const mockRecord = createMockRecord();
  const mockCandidates = createMockCandidates();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverRecordsService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: StoreSubAccountService,
          useValue: storeSubAccountService,
        },
      ],
    }).compile();

    service = module.get<HandoverRecordsService>(HandoverRecordsService);
  });

  describe('createHandoverRecord', () => {
    it('主账号自交班模式：成功创建记录', async () => {
      prismaService.storeHandoverRecord.create.mockResolvedValue({
        ...mockRecord,
        handoverMode: HandoverMode.self_main_account,
        toEmployeeId: null,
        toEmployee: null,
      });

      const result = await service.createHandoverRecord(ownerUser, {
        handoverMode: HandoverMode.self_main_account,
      });

      expect(result.handoverMode).toBe('self_main_account');
      expect(result.toEmployeeId).toBeNull();
      expect(prismaService.storeHandoverRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storeId: 100,
            fromEmployeeId: 10,
            handoverMode: HandoverMode.self_main_account,
            status: HandoverStatus.pending,
          }),
        }),
      );
    });

    it('子账号交班模式：成功创建记录并指定接收人', async () => {
      storeSubAccountService.listAssignableHandoverCandidates.mockResolvedValue(
        mockCandidates,
      );
      prismaService.storeHandoverRecord.create.mockResolvedValue(mockRecord);

      const result = await service.createHandoverRecord(subAccountUser, {
        handoverMode: HandoverMode.sub_account,
        toEmployeeId: 20,
        note: '交班备注',
      });

      expect(result.handoverMode).toBe('sub_account');
      expect(result.toEmployeeId).toBe(20);
    });

    it('子账号交班模式：未指定接收人应抛出 BadRequestException', async () => {
      await expect(
        service.createHandoverRecord(subAccountUser, {
          handoverMode: HandoverMode.sub_account,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('主账号自交班模式：指定接收人应抛出 BadRequestException', async () => {
      await expect(
        service.createHandoverRecord(ownerUser, {
          handoverMode: HandoverMode.self_main_account,
          toEmployeeId: 20,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('指定了不在候选人列表中的接收人应抛出 NotFoundException', async () => {
      storeSubAccountService.listAssignableHandoverCandidates.mockResolvedValue(
        mockCandidates,
      );

      await expect(
        service.createHandoverRecord(subAccountUser, {
          handoverMode: HandoverMode.sub_account,
          toEmployeeId: 999,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('用户无门店权限应抛出 ForbiddenException', async () => {
      const userWithoutMembership = {
        ...ownerUser,
        currentMembership: null,
      };

      await expect(
        service.createHandoverRecord(userWithoutMembership, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('自动推断交班模式：子账号默认使用 sub_account 模式', async () => {
      storeSubAccountService.listAssignableHandoverCandidates.mockResolvedValue(
        mockCandidates,
      );
      prismaService.storeHandoverRecord.create.mockResolvedValue(mockRecord);

      await service.createHandoverRecord(subAccountUser, {
        toEmployeeId: 20,
      });

      expect(prismaService.storeHandoverRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            handoverMode: HandoverMode.sub_account,
          }),
        }),
      );
    });

    it('自动推断交班模式：主账号默认使用 self_main_account 模式', async () => {
      prismaService.storeHandoverRecord.create.mockResolvedValue({
        ...mockRecord,
        handoverMode: HandoverMode.self_main_account,
        toEmployeeId: null,
        toEmployee: null,
      });

      await service.createHandoverRecord(ownerUser, {});

      expect(prismaService.storeHandoverRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            handoverMode: HandoverMode.self_main_account,
          }),
        }),
      );
    });
  });

  describe('completeHandoverRecord', () => {
    it('接收人成功完成交班', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);
      prismaService.storeHandoverRecord.update.mockResolvedValue({
        ...mockRecord,
        status: HandoverStatus.completed,
        handoverAt: new Date('2026-05-13T12:00:00.000Z'),
        toSubAccountId: 5,
      });

      const result = await service.completeHandoverRecord(subAccountUser, 1, {
        note: '确认完成',
      });

      expect(result.status).toBe('completed');
      expect(result.handoverAt).toBeGreaterThan(0);
    });

    it('非接收人尝试完成应抛出 ForbiddenException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);

      await expect(
        service.completeHandoverRecord(managerUser, 1, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('完成非 pending 状态的记录应抛出 BadRequestException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue({
        ...mockRecord,
        status: HandoverStatus.completed,
      });

      await expect(
        service.completeHandoverRecord(subAccountUser, 1, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('记录不存在应抛出 NotFoundException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.completeHandoverRecord(subAccountUser, 999, {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelHandoverRecord', () => {
    it('发起人成功取消交班', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);
      prismaService.storeHandoverRecord.update.mockResolvedValue({
        ...mockRecord,
        status: HandoverStatus.cancelled,
        reason: '临时有事',
      });

      const result = await service.cancelHandoverRecord(ownerUser, 1, {
        reason: '临时有事',
      });

      expect(result.status).toBe('cancelled');
      expect(result.reason).toBe('临时有事');
    });

    it('主账号/管理员成功取消他人交班', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);
      prismaService.storeHandoverRecord.update.mockResolvedValue({
        ...mockRecord,
        status: HandoverStatus.cancelled,
      });

      const result = await service.cancelHandoverRecord(managerUser, 1, {
        reason: '取消',
      });

      expect(result.status).toBe('cancelled');
    });

    it('非发起人且非管理员尝试取消应抛出 ForbiddenException', async () => {
      const otherUser = {
        ...subAccountUser,
        currentMembership: {
          ...subAccountUser.currentMembership!,
          linkedEmployeeId: 99,
        },
      };

      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);

      await expect(
        service.cancelHandoverRecord(otherUser, 1, { reason: '尝试取消' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('取消非 pending 状态的记录应抛出 BadRequestException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue({
        ...mockRecord,
        status: HandoverStatus.completed,
      });

      await expect(
        service.cancelHandoverRecord(ownerUser, 1, { reason: '取消' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listHandoverRecords', () => {
    it('成功获取交班记录列表', async () => {
      const records = [mockRecord];
      prismaService.storeHandoverRecord.findMany.mockResolvedValue(records);
      prismaService.storeHandoverRecord.count.mockResolvedValue(1);

      const result = await service.listHandoverRecords(ownerUser, 10, 0);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(prismaService.storeHandoverRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId: 100 },
          take: 10,
          skip: 0,
        }),
      );
    });
  });

  describe('getHandoverRecord', () => {
    it('成功获取单条记录', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);

      const result = await service.getHandoverRecord(ownerUser, 1);

      expect(result.id).toBe(1);
    });

    it('记录不存在应抛出 NotFoundException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(null);

      await expect(service.getHandoverRecord(ownerUser, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listHandoverRecordSummaries', () => {
    it('返回交班记录弹窗摘要列表', async () => {
      prismaService.storeHandoverRecord.findMany.mockResolvedValue([
        mockRecord,
      ]);
      prismaService.storeHandoverRecord.count.mockResolvedValue(1);
      prismaService.employeeShift.findFirst.mockResolvedValue({
        shiftType: EmployeeShiftType.morning,
        shiftName: '早班',
        startTime: '09:00',
        endTime: '17:00',
      });
      prismaService.saleOrder.aggregate.mockResolvedValue({
        _sum: { totalRevenue: new Prisma.Decimal('1004.65') },
      });

      const result = await service.listHandoverRecordSummaries(ownerUser, {
        preset: 'today',
        limit: 20,
        offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 1,
        operatorName: '老板',
        shiftType: EmployeeShiftType.morning,
        shiftLabel: '早班',
        totalRevenue: 1004.65,
        displayStatus: 'active',
      });
      expect(result.items[0].timeDesc).toContain('09:00–17:00');
      expect(prismaService.storeHandoverRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            storeId: 100,
            createdAt: expect.any(Object),
          }),
          take: 20,
          skip: 0,
        }),
      );
    });

    it('指定 date 时优先按日期过滤', async () => {
      prismaService.storeHandoverRecord.findMany.mockResolvedValue([]);
      prismaService.storeHandoverRecord.count.mockResolvedValue(0);

      await service.listHandoverRecordSummaries(ownerUser, {
        preset: '30d',
        date: '2026-06-02',
      });

      expect(prismaService.storeHandoverRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: new Date(2026, 5, 2, 0, 0, 0, 0),
              lte: new Date(2026, 5, 2, 23, 59, 59, 999),
            }),
          }),
        }),
      );
    });
  });

  describe('getHandoverCandidates', () => {
    it('成功获取候选人列表', async () => {
      storeSubAccountService.listAssignableHandoverCandidates.mockResolvedValue(
        mockCandidates,
      );

      const result = await service.getHandoverCandidates(100);

      expect(result).toHaveLength(2);
      expect(result[0].employeeId).toBe(20);
      expect(result[1].employeeId).toBe(30);
    });
  });

  describe('getMyPendingHandover', () => {
    it('成功获取当前用户待处理的交班', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);

      const result = await service.getMyPendingHandover(ownerUser);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
      expect(prismaService.storeHandoverRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ fromEmployeeId: 10 }, { toEmployeeId: 10 }],
          }),
        }),
      );
    });

    it('无待处理交班时返回 null', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(null);

      const result = await service.getMyPendingHandover(ownerUser);

      expect(result).toBeNull();
    });

    it('用户无关联员工时返回 null', async () => {
      const userWithoutEmployee = {
        ...ownerUser,
        currentMembership: {
          ...ownerUser.currentMembership!,
          linkedEmployeeId: null,
        },
      };

      const result = await service.getMyPendingHandover(userWithoutEmployee);

      expect(result).toBeNull();
    });
  });
});
