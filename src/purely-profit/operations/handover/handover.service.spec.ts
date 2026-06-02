import { Test, TestingModule } from '@nestjs/testing';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmService } from './handover-confirm.service';
import { HandoverPageService } from './handover-page.service';
import { HandoverRecordsService } from './handover-records.service';
import { HandoverService } from './handover.service';
import { createOwnerUser, createSubAccountUser } from './hover.spec-helpers';

describe('HandoverService', () => {
  let service: HandoverService;

  const handoverPageService = {
    getHandoverPage: jest.fn(),
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

  const ownerUser = createOwnerUser();
  const subAccountUser = createSubAccountUser();

  beforeEach(async () => {
    jest.clearAllMocks();

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
      ],
    }).compile();

    service = module.get<HandoverService>(HandoverService);
  });

  describe('页面与附加项委托', () => {
    it('getHandoverPage 委托给 handoverPageService', async () => {
      const query = { shiftType: 'morning' as const, operatorName: '员工A' };
      const mockResult = {
        selectedShiftType: 'morning',
        shiftInfo: { operatorName: '员工A', shiftType: 'morning' },
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
      expect(handoverPageService.getHandoverPage).toHaveBeenCalledWith(
        subAccountUser,
        query,
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
        handedOverAt: Date.now(),
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
