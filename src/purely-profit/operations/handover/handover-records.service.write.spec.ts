import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { HandoverMode, HandoverStatus } from '@prisma/client';
import { setupHandoverRecordsSpec } from './handover-records.spec-helpers';

describe('HandoverRecordsService - 写操作', () => {
  const ctx = setupHandoverRecordsSpec();
  const {
    prismaService,
    storeSubAccountService,
    ownerUser,
    subAccountUser,
    managerUser,
    mockRecord,
    mockCandidates,
  } = ctx;

  describe('createHandoverRecord', () => {
    it('主账号自交班模式：成功创建记录', async () => {
      prismaService.storeHandoverRecord.create.mockResolvedValue({
        ...mockRecord,
        handoverMode: HandoverMode.self_main_account,
        toEmployeeId: null,
        toEmployee: null,
      });

      const result = await ctx.service.createHandoverRecord(ownerUser, {
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

      const result = await ctx.service.createHandoverRecord(subAccountUser, {
        handoverMode: HandoverMode.sub_account,
        toEmployeeId: 20,
        note: '交班备注',
      });

      expect(result.handoverMode).toBe('sub_account');
      expect(result.toEmployeeId).toBe(20);
    });

    it('子账号交班模式：未指定接收人应抛出 BadRequestException', async () => {
      await expect(
        ctx.service.createHandoverRecord(subAccountUser, {
          handoverMode: HandoverMode.sub_account,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('主账号自交班模式：指定接收人应抛出 BadRequestException', async () => {
      await expect(
        ctx.service.createHandoverRecord(ownerUser, {
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
        ctx.service.createHandoverRecord(subAccountUser, {
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
        ctx.service.createHandoverRecord(userWithoutMembership, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('自动推断交班模式：子账号默认使用 sub_account 模式', async () => {
      storeSubAccountService.listAssignableHandoverCandidates.mockResolvedValue(
        mockCandidates,
      );
      prismaService.storeHandoverRecord.create.mockResolvedValue(mockRecord);

      await ctx.service.createHandoverRecord(subAccountUser, {
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

      await ctx.service.createHandoverRecord(ownerUser, {});

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
      prismaService.storeHandoverRecord.count.mockResolvedValue(0);
      prismaService.storeHandoverRecord.update.mockResolvedValue({
        ...mockRecord,
        status: HandoverStatus.completed,
        handoverAt: new Date('2026-05-13T12:00:00.000Z'),
        toSubAccountId: 5,
      });

      const result = await ctx.service.completeHandoverRecord(
        subAccountUser,
        1,
        {
          note: '确认完成',
        },
      );

      expect(result.status).toBe('completed');
      expect(result.handoverAt).toBeGreaterThan(0);
    });

    it('非接收人尝试完成应抛出 ForbiddenException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);

      await expect(
        ctx.service.completeHandoverRecord(managerUser, 1, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('未指定接收人的自交班记录仅允许发起人或主账号/管理员完成', async () => {
      const selfRecord = {
        ...mockRecord,
        fromEmployeeId: 10,
        toEmployeeId: null,
        toEmployee: null,
        handoverMode: HandoverMode.self_main_account,
      };
      const otherCashierUser = {
        ...subAccountUser,
        currentMembership: {
          ...subAccountUser.currentMembership!,
          linkedEmployeeId: 99,
        },
      };

      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(selfRecord);

      await expect(
        ctx.service.completeHandoverRecord(otherCashierUser, 1, {}),
      ).rejects.toThrow(ForbiddenException);

      prismaService.storeHandoverRecord.count.mockResolvedValue(0);
      prismaService.storeHandoverRecord.update.mockResolvedValue({
        ...selfRecord,
        status: HandoverStatus.completed,
        handoverAt: new Date('2026-05-13T12:10:00.000Z'),
      });

      const ownerResult = await ctx.service.completeHandoverRecord(
        ownerUser,
        1,
        {},
      );

      expect(ownerResult.status).toBe('completed');
    });

    it('完成非 pending 状态的记录应抛出 BadRequestException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue({
        ...mockRecord,
        status: HandoverStatus.completed,
      });

      await expect(
        ctx.service.completeHandoverRecord(subAccountUser, 1, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('记录不存在应抛出 NotFoundException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(null);

      await expect(
        ctx.service.completeHandoverRecord(subAccountUser, 999, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('F1: 同一员工当天已有已完成交班记录时，应抛出 ConflictException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue(mockRecord);
      // 定位 pending 记录所属班次：createdAt（2026-05-13 10:00）落在早班 09:00-18:00 内
      prismaService.employeeShift.findMany.mockResolvedValue([
        {
          id: 1,
          employeeId: 10,
          startTime: '09:00',
          endTime: '18:00',
          date: new Date('2026-05-13T00:00:00.000Z'),
        },
      ]);
      prismaService.storeHandoverRecord.count.mockResolvedValue(1);

      await expect(
        ctx.service.completeHandoverRecord(subAccountUser, 1, {}),
      ).rejects.toThrow(ConflictException);
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

      const result = await ctx.service.cancelHandoverRecord(ownerUser, 1, {
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

      const result = await ctx.service.cancelHandoverRecord(managerUser, 1, {
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
        ctx.service.cancelHandoverRecord(otherUser, 1, { reason: '尝试取消' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('取消非 pending 状态的记录应抛出 BadRequestException', async () => {
      prismaService.storeHandoverRecord.findFirst.mockResolvedValue({
        ...mockRecord,
        status: HandoverStatus.completed,
      });

      await expect(
        ctx.service.cancelHandoverRecord(ownerUser, 1, { reason: '取消' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
