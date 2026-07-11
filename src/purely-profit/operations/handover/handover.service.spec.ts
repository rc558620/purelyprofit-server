import { Test, TestingModule } from '@nestjs/testing';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmService } from './handover-confirm.service';
import { HandoverPageService } from './handover-page.service';
import { HandoverRecordsService } from './handover-records.service';
import { HandoverService } from './handover.service';
import { SpaceSessionAutoCheckoutService } from '../spaces/space-session-auto-checkout.service';
import {
  createManagerUser,
  createOwnerUser,
  createSubAccountUser,
} from './hover.spec-helpers';

describe('HandoverService', () => {
  let service: HandoverService;

  const handoverPageService = {
    getHandoverPage: jest.fn(),
    resolveHandoverOperationAccess: jest.fn(),
  };

  const handoverConfirmService = {
    confirmHandover: jest.fn(),
  };

  const handoverRecordsService = {
    createHandoverRecord: jest.fn(),
    completeHandoverRecord: jest.fn(),
    cancelHandoverRecord: jest.fn(),
    listHandoverRecords: jest.fn(),
    getHandoverRecord: jest.fn(),
    listHandoverRecordSummaries: jest.fn(),
    getHandoverCandidates: jest.fn(),
    getMyPendingHandover: jest.fn(),
  };

  const handoverAdditionalItemsService = {
    listAdditionalItems: jest.fn(),
    createAdditionalItem: jest.fn(),
    updateAdditionalItem: jest.fn(),
    deleteAdditionalItem: jest.fn(),
  };

  const spaceSessionAutoCheckoutService = {
    autoCheckoutExpiredCountdownSessions: jest.fn(),
  };

  const ownerUser = createOwnerUser();
  const subAccountUser = createSubAccountUser();
  const managerUser = createManagerUser();

  beforeEach(async () => {
    jest.clearAllMocks();
    handoverPageService.getHandoverPage.mockResolvedValue({
      canOperate: true,
      operationBlockedReason: null,
      selectedShiftType: 'morning',
    });
    handoverPageService.resolveHandoverOperationAccess.mockResolvedValue({
      canOperate: true,
      blockedReason: null,
      selectedShiftType: 'morning',
    });
    spaceSessionAutoCheckoutService.autoCheckoutExpiredCountdownSessions.mockResolvedValue(
      0,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverService,
        { provide: HandoverPageService, useValue: handoverPageService },
        { provide: HandoverConfirmService, useValue: handoverConfirmService },
        { provide: HandoverRecordsService, useValue: handoverRecordsService },
        {
          provide: HandoverAdditionalItemsService,
          useValue: handoverAdditionalItemsService,
        },
        {
          provide: SpaceSessionAutoCheckoutService,
          useValue: spaceSessionAutoCheckoutService,
        },
      ],
    }).compile();

    service = module.get<HandoverService>(HandoverService);
  });

  describe('页面与附加项委托', () => {
    it('getHandoverPage 委托给 handoverPageService', async () => {
      const query = { shiftType: 'morning' as const, operatorName: '员工A' };
      const mockResult = {
        selectedShiftType: 'morning',
        shiftInfo: {
          operatorName: '员工A',
          shiftType: 'morning',
          shiftName: '早班',
          shiftLabel: '早班',
        },
        receiverName: null,
        revenueSummary: {
          totalRevenue: 0,
          orderCount: 0,
          additionalRevenue: 0,
          spaceRevenue: 0,
          pettyCache: 0,
        },
        paymentItems: [],
        orderItems: [],
        additionalItems: [],
      };
      handoverPageService.getHandoverPage.mockResolvedValue(mockResult);

      const result = await service.getHandoverPage(subAccountUser, query);

      expect(result).toBe(mockResult);
      expect(
        spaceSessionAutoCheckoutService.autoCheckoutExpiredCountdownSessions,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ id: 0, email: 'system@auto-checkout' }),
        100,
        expect.any(Number),
        'handover:page',
      );
      expect(handoverPageService.getHandoverPage).toHaveBeenCalledWith(
        subAccountUser,
        query,
      );
    });

    it('getHandoverRecord 读取详情前会先补偿自动结账', async () => {
      const mockRecord = { id: 3 };
      handoverRecordsService.getHandoverRecord.mockResolvedValue(mockRecord);

      const result = await service.getHandoverRecord(ownerUser, 3);

      expect(result).toBe(mockRecord);
      expect(
        spaceSessionAutoCheckoutService.autoCheckoutExpiredCountdownSessions,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ id: 0, email: 'system@auto-checkout' }),
        100,
        expect.any(Number),
        'handover:record-detail',
      );
      expect(handoverRecordsService.getHandoverRecord).toHaveBeenCalledWith(
        ownerUser,
        3,
      );
    });

    it('listAdditionalItems 委托给 handoverAdditionalItemsService', async () => {
      const mockResult = { items: [{ id: 1, name: '房卡' }] };
      handoverAdditionalItemsService.listAdditionalItems.mockResolvedValue(
        mockResult,
      );

      const result = await service.listAdditionalItems(ownerUser);

      expect(result).toBe(mockResult);
      expect(
        handoverAdditionalItemsService.listAdditionalItems,
      ).toHaveBeenCalledWith(ownerUser);
    });

    it('createAdditionalItem 委托给 handoverAdditionalItemsService', async () => {
      const dto = { name: '房卡' };
      const mockResult = { id: 1, name: '房卡', createdAt: 1, updatedAt: 1 };
      handoverAdditionalItemsService.createAdditionalItem.mockResolvedValue(
        mockResult,
      );

      const result = await service.createAdditionalItem(ownerUser, dto);

      expect(result).toBe(mockResult);
      expect(
        handoverAdditionalItemsService.createAdditionalItem,
      ).toHaveBeenCalledWith(ownerUser, dto);
    });

    it('updateAdditionalItem 委托给 handoverAdditionalItemsService', async () => {
      const dto = { name: '钥匙' };
      const mockResult = { id: 1, name: '钥匙', createdAt: 1, updatedAt: 1 };
      handoverAdditionalItemsService.updateAdditionalItem.mockResolvedValue(
        mockResult,
      );

      const result = await service.updateAdditionalItem(ownerUser, 1, dto);

      expect(result).toBe(mockResult);
      expect(
        handoverAdditionalItemsService.updateAdditionalItem,
      ).toHaveBeenCalledWith(ownerUser, 1, dto);
    });

    it('店长无本人班次时仍可新增交班附加项', async () => {
      const dto = { name: '房卡' };
      const mockResult = { id: 2, name: '房卡', createdAt: 1, updatedAt: 1 };
      handoverPageService.getHandoverPage.mockResolvedValue({
        canOperate: false,
        operationBlockedReason: '当前时段没有该员工本人班次，暂不允许操作',
        selectedShiftType: 'morning',
      });
      handoverAdditionalItemsService.createAdditionalItem.mockResolvedValue(
        mockResult,
      );

      const result = await service.createAdditionalItem(managerUser, dto);

      expect(result).toBe(mockResult);
      expect(
        handoverAdditionalItemsService.createAdditionalItem,
      ).toHaveBeenCalledWith(managerUser, dto);
      expect(handoverPageService.getHandoverPage).not.toHaveBeenCalled();
    });

    it('店长无本人班次时仍可修改交班附加项', async () => {
      const dto = { name: '钥匙' };
      const mockResult = { id: 1, name: '钥匙', createdAt: 1, updatedAt: 1 };
      handoverPageService.getHandoverPage.mockResolvedValue({
        canOperate: false,
        operationBlockedReason: '当前时段没有该员工本人班次，暂不允许操作',
        selectedShiftType: 'morning',
      });
      handoverAdditionalItemsService.updateAdditionalItem.mockResolvedValue(
        mockResult,
      );

      const result = await service.updateAdditionalItem(managerUser, 1, dto);

      expect(result).toBe(mockResult);
      expect(
        handoverAdditionalItemsService.updateAdditionalItem,
      ).toHaveBeenCalledWith(managerUser, 1, dto);
      expect(handoverPageService.getHandoverPage).not.toHaveBeenCalled();
    });

    it('店长无本人班次时仍可删除交班附加项', async () => {
      handoverPageService.getHandoverPage.mockResolvedValue({
        canOperate: false,
        operationBlockedReason: '当前时段没有该员工本人班次，暂不允许操作',
        selectedShiftType: 'morning',
      });
      handoverAdditionalItemsService.deleteAdditionalItem.mockResolvedValue(
        undefined,
      );

      await service.deleteAdditionalItem(managerUser, 1);

      expect(
        handoverAdditionalItemsService.deleteAdditionalItem,
      ).toHaveBeenCalledWith(managerUser, 1);
      expect(handoverPageService.getHandoverPage).not.toHaveBeenCalled();
    });

    it('deleteAdditionalItem 委托给 handoverAdditionalItemsService', async () => {
      handoverAdditionalItemsService.deleteAdditionalItem.mockResolvedValue(
        undefined,
      );

      await service.deleteAdditionalItem(ownerUser, 1);

      expect(
        handoverAdditionalItemsService.deleteAdditionalItem,
      ).toHaveBeenCalledWith(ownerUser, 1);
    });
  });

  describe('交班确认委托', () => {
    it('confirmHandover 委托给 handoverConfirmService', async () => {
      const dto = {
        shiftType: 'morning' as const,
        confirmedAt: Date.now(),
        note: '交班',
        additionalItems: [],
      };
      const mockResult = {
        id: 1,
        handoverMode: 'self_main_account',
        status: 'completed',
        fromEmployeeId: 10,
        fromEmployeeName: '老板',
        toEmployeeId: null,
        toEmployeeName: null,
        note: '交班',
        reason: null,
        handoverAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      handoverConfirmService.confirmHandover.mockResolvedValue(mockResult);

      const result = await service.confirmHandover(ownerUser, dto);

      expect(result).toBe(mockResult);
      expect(handoverConfirmService.confirmHandover).toHaveBeenCalledWith(
        ownerUser,
        dto,
      );
    });

    it('收银员操作非本人班次时 confirmHandover 应抛出 ForbiddenException', async () => {
      const dto = {
        shiftType: 'late' as const,
        confirmedAt: Date.now(),
        note: '交班',
        additionalItems: [],
      };
      handoverPageService.resolveHandoverOperationAccess.mockResolvedValue({
        canOperate: false,
        blockedReason: '当前班次不属于该收银员，暂不允许操作',
        selectedShiftType: 'late',
      });

      await expect(
        service.confirmHandover(subAccountUser, dto),
      ).rejects.toThrow('当前班次不属于该收银员，暂不允许操作');
      expect(handoverConfirmService.confirmHandover).not.toHaveBeenCalled();
    });

    it('店长账号在页面可操作时 confirmHandover 应委托给 handoverConfirmService', async () => {
      const dto = {
        shiftType: 'morning' as const,
        confirmedAt: Date.now(),
        note: '交班',
        additionalItems: [],
      };
      const mockResult = {
        id: 2,
        handoverMode: 'self_main_account',
        status: 'completed',
        fromEmployeeId: 20,
        fromEmployeeName: '收银员1',
        toEmployeeId: 30,
        toEmployeeName: '经理',
        note: '交班',
        reason: null,
        handoverAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      handoverPageService.resolveHandoverOperationAccess.mockResolvedValue({
        canOperate: true,
        blockedReason: null,
        selectedShiftType: 'morning',
      });
      handoverConfirmService.confirmHandover.mockResolvedValue(mockResult);

      const result = await service.confirmHandover(managerUser, dto);

      expect(result).toBe(mockResult);
      expect(handoverConfirmService.confirmHandover).toHaveBeenCalledWith(
        managerUser,
        dto,
      );
    });

    it('收银员重复提交已完成班次时 confirmHandover 应抛出 ForbiddenException', async () => {
      const dto = {
        shiftType: 'morning' as const,
        confirmedAt: Date.now(),
        note: '重复交班',
        additionalItems: [],
      };
      handoverPageService.resolveHandoverOperationAccess.mockResolvedValue({
        canOperate: true,
        blockedReason: null,
        selectedShiftType: 'late',
      });

      await expect(
        service.confirmHandover(subAccountUser, dto),
      ).rejects.toThrow('当前班次已完成交班，暂不允许重复操作');
      expect(handoverConfirmService.confirmHandover).not.toHaveBeenCalled();
    });

    it('非收银员重复提交已完成班次时也应抛出 ForbiddenException', async () => {
      const dto = {
        shiftType: 'morning' as const,
        confirmedAt: Date.now(),
        note: '重复交班',
        additionalItems: [],
      };
      handoverPageService.resolveHandoverOperationAccess.mockResolvedValue({
        canOperate: true,
        blockedReason: null,
        selectedShiftType: 'late',
      });

      await expect(service.confirmHandover(ownerUser, dto)).rejects.toThrow(
        '当前班次已完成交班，暂不允许重复操作',
      );
      expect(handoverConfirmService.confirmHandover).not.toHaveBeenCalled();
    });

    it('confirmHandover 权限校验仅解析权限上下文，不触发整页渲染（BUG-5 优化）', async () => {
      const dto = {
        shiftType: 'morning' as const,
        confirmedAt: Date.now(),
        note: '交班',
        additionalItems: [],
      };
      const mockResult = {
        id: 2,
        handoverMode: 'self_main_account',
        status: 'completed',
        fromEmployeeId: 20,
        fromEmployeeName: '收银员1',
        toEmployeeId: 30,
        toEmployeeName: '经理',
        note: '交班',
        reason: null,
        handoverAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      handoverPageService.resolveHandoverOperationAccess.mockResolvedValue({
        canOperate: true,
        blockedReason: null,
        selectedShiftType: 'morning',
      });
      handoverConfirmService.confirmHandover.mockResolvedValue(mockResult);

      const result = await service.confirmHandover(managerUser, dto);

      expect(result).toBe(mockResult);
      expect(
        handoverPageService.resolveHandoverOperationAccess,
      ).toHaveBeenCalledWith(managerUser, 'morning');
      // 关键断言：权限校验不再调用整页渲染，省去指标聚合查询。
      expect(handoverPageService.getHandoverPage).not.toHaveBeenCalled();
    });
  });

  describe('交班记录委托', () => {
    it('createHandoverRecord 委托给 handoverRecordsService', async () => {
      const dto = { handoverMode: 'self_main_account' as const };
      const mockResult = {
        id: 1,
        handoverMode: 'self_main_account',
        status: 'pending',
        fromEmployeeId: 10,
        fromEmployeeName: '老板',
        toEmployeeId: null,
        toEmployeeName: null,
        note: null,
        reason: null,
        handoverAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      handoverRecordsService.createHandoverRecord.mockResolvedValue(mockResult);

      const result = await service.createHandoverRecord(ownerUser, dto);

      expect(result).toBe(mockResult);
      expect(handoverRecordsService.createHandoverRecord).toHaveBeenCalledWith(
        ownerUser,
        dto,
      );
    });

    it('收银员操作非本人当前班次时 createHandoverRecord 应抛出 ForbiddenException', async () => {
      handoverPageService.resolveHandoverOperationAccess.mockResolvedValue({
        canOperate: false,
        blockedReason: '当前时段没有该收银员本人班次，暂不允许操作',
        selectedShiftType: 'morning',
      });

      await expect(
        service.createHandoverRecord(subAccountUser, {
          handoverMode: 'sub_account',
        }),
      ).rejects.toThrow('当前时段没有该收银员本人班次，暂不允许操作');
      expect(
        handoverRecordsService.createHandoverRecord,
      ).not.toHaveBeenCalled();
    });

    it('completeHandoverRecord 委托给 handoverRecordsService', async () => {
      const dto = { note: '完成' };
      const mockResult = {
        id: 1,
        handoverMode: 'sub_account',
        status: 'completed',
        fromEmployeeId: 10,
        fromEmployeeName: '老板',
        toEmployeeId: 20,
        toEmployeeName: '员工A',
        note: '完成',
        reason: null,
        handoverAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      handoverRecordsService.completeHandoverRecord.mockResolvedValue(
        mockResult,
      );

      const result = await service.completeHandoverRecord(
        subAccountUser,
        1,
        dto,
      );

      expect(result).toBe(mockResult);
      expect(
        handoverRecordsService.completeHandoverRecord,
      ).toHaveBeenCalledWith(subAccountUser, 1, dto);
    });

    it('cancelHandoverRecord 委托给 handoverRecordsService', async () => {
      const dto = { reason: '取消' };
      const mockResult = {
        id: 1,
        handoverMode: 'sub_account',
        status: 'cancelled',
        fromEmployeeId: 10,
        fromEmployeeName: '老板',
        toEmployeeId: 20,
        toEmployeeName: '员工A',
        note: null,
        reason: '取消',
        handoverAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      handoverRecordsService.cancelHandoverRecord.mockResolvedValue(mockResult);

      const result = await service.cancelHandoverRecord(ownerUser, 1, dto);

      expect(result).toBe(mockResult);
      expect(handoverRecordsService.cancelHandoverRecord).toHaveBeenCalledWith(
        ownerUser,
        1,
        dto,
      );
    });

    it('listHandoverRecords 委托给 handoverRecordsService', async () => {
      const mockResult = {
        items: [],
        total: 0,
      };
      handoverRecordsService.listHandoverRecords.mockResolvedValue(mockResult);

      const result = await service.listHandoverRecords(ownerUser, 20, 0);

      expect(result).toBe(mockResult);
      expect(handoverRecordsService.listHandoverRecords).toHaveBeenCalledWith(
        ownerUser,
        20,
        0,
      );
    });

    it('getHandoverRecord 委托给 handoverRecordsService', async () => {
      const mockResult = {
        id: 1,
        handoverMode: 'sub_account',
        status: 'pending',
        fromEmployeeId: 10,
        fromEmployeeName: '老板',
        toEmployeeId: 20,
        toEmployeeName: '员工A',
        note: null,
        reason: null,
        handoverAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      handoverRecordsService.getHandoverRecord.mockResolvedValue(mockResult);

      const result = await service.getHandoverRecord(ownerUser, 1);

      expect(result).toBe(mockResult);
      expect(handoverRecordsService.getHandoverRecord).toHaveBeenCalledWith(
        ownerUser,
        1,
      );
    });

    it('listHandoverRecordSummaries 委托给 handoverRecordsService', async () => {
      const query = { preset: 'today' as const, limit: 20, offset: 0 };
      const mockResult = {
        items: [
          {
            id: 1,
            operatorName: '老板',
            shiftType: 'morning',
            shiftLabel: '早班',
            startTime: '09:00',
            endTime: '17:00',
            timeDesc: '06-02  09:00–17:00',
            totalRevenue: 1004.65,
            status: 'pending',
            displayStatus: 'active',
            handoverAt: null,
            createdAt: Date.now(),
          },
        ],
        total: 1,
      };
      handoverRecordsService.listHandoverRecordSummaries.mockResolvedValue(
        mockResult,
      );

      const result = await service.listHandoverRecordSummaries(
        ownerUser,
        query,
      );

      expect(result).toBe(mockResult);
      expect(
        handoverRecordsService.listHandoverRecordSummaries,
      ).toHaveBeenCalledWith(ownerUser, query);
    });

    it('getHandoverCandidates 委托给 handoverRecordsService', async () => {
      const mockResult = [
        {
          employeeId: 20,
          employeeName: '员工A',
          slotIndex: 1,
          role: 'cashier',
        },
      ];
      handoverRecordsService.getHandoverCandidates.mockResolvedValue(
        mockResult,
      );

      const result = await service.getHandoverCandidates(100);

      expect(result).toBe(mockResult);
      expect(handoverRecordsService.getHandoverCandidates).toHaveBeenCalledWith(
        100,
      );
    });

    it('getMyPendingHandover 委托给 handoverRecordsService', async () => {
      const mockResult = {
        id: 1,
        handoverMode: 'sub_account',
        status: 'pending',
        fromEmployeeId: 10,
        fromEmployeeName: '老板',
        toEmployeeId: 20,
        toEmployeeName: '员工A',
        note: null,
        reason: null,
        handoverAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      handoverRecordsService.getMyPendingHandover.mockResolvedValue(mockResult);

      const result = await service.getMyPendingHandover(subAccountUser);

      expect(result).toBe(mockResult);
      expect(handoverRecordsService.getMyPendingHandover).toHaveBeenCalledWith(
        subAccountUser,
      );
    });
  });
});
