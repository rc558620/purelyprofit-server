import {
  EmployeeShiftType,
  HandoverMode,
  HandoverStatus,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmShiftService } from './handover-confirm-shift.service';
import { HandoverConfirmService } from './handover-confirm.service';
import {
  createHandoverPrismaMock,
  createStoreSubAccountServiceMock,
  createSubAccountUser,
} from './hover.spec-helpers';

describe('HandoverConfirmService', () => {
  let service: HandoverConfirmService;

  const prismaService = createHandoverPrismaMock();
  const storeSubAccountService = createStoreSubAccountServiceMock();
  const handoverAdditionalItemsService = {
    resolveConfirmAdditionalItems: jest.fn(),
  };
  const handoverConfirmShiftService = {
    findSourceShiftRecord: jest.fn(),
    ensureShiftNotHandedOver: jest.fn(),
    resolveReceiverCandidate: jest.fn(),
  };

  const subAccountUser = createSubAccountUser();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverConfirmService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: StoreSubAccountService,
          useValue: storeSubAccountService,
        },
        {
          provide: HandoverAdditionalItemsService,
          useValue: handoverAdditionalItemsService,
        },
        {
          provide: HandoverConfirmShiftService,
          useValue: handoverConfirmShiftService,
        },
      ],
    }).compile();

    service = module.get<HandoverConfirmService>(HandoverConfirmService);
    handoverConfirmShiftService.findSourceShiftRecord.mockResolvedValue({
      id: 201,
      employeeId: 20,
      employeeName: '员工A',
      shiftType: EmployeeShiftType.morning,
      shiftName: '早班',
      date: new Date(2026, 4, 13),
      startTime: '09:00',
      endTime: '17:00',
      createdAt: new Date(2026, 4, 13, 8, 0, 0),
    });
    handoverConfirmShiftService.resolveReceiverCandidate.mockResolvedValue({
      employeeId: 30,
      employeeName: '经理',
      subAccountId: 6,
    });
    handoverConfirmShiftService.ensureShiftNotHandedOver.mockResolvedValue(
      undefined,
    );
    storeSubAccountService.findAssignedSubAccountByEmployee.mockResolvedValue({
      id: 6,
    });
  });

  describe('confirmHandover', () => {
    it('会创建已完成的交班记录并保存附加项', async () => {
      handoverAdditionalItemsService.resolveConfirmAdditionalItems.mockResolvedValue(
        [{ id: 101, value: '2 张房卡' }],
      );
      const confirmedAt = new Date(2026, 4, 13, 12, 0, 0);
      prismaService.storeHandoverRecord.create.mockResolvedValue({
        id: 9,
        storeId: 100,
        fromEmployeeId: 20,
        toEmployeeId: 30,
        fromSubAccountId: 5,
        toSubAccountId: 6,
        actorStaffId: 2,
        fromEmployeeNameSnapshot: '员工A',
        shiftTypeSnapshot: EmployeeShiftType.morning,
        shiftNameSnapshot: null,
        shiftStartTimeSnapshot: '09:00',
        shiftEndTimeSnapshot: '17:00',
        handoverMode: HandoverMode.sub_account,
        status: HandoverStatus.completed,
        handoverAt: confirmedAt,
        note: '完成交班',
        reason: null,
        createdAt: new Date(2026, 4, 13, 10, 0, 0),
        updatedAt: new Date(2026, 4, 13, 10, 0, 0),
        fromEmployee: { id: 20, name: '员工A' },
        toEmployee: { id: 30, name: '经理' },
        additionalValues: [],
      });

      const result = await service.confirmHandover(subAccountUser, {
        shiftType: 'morning',
        confirmedAt: confirmedAt.getTime(),
        note: '  完成交班  ',
        additionalItems: [{ id: 101, value: ' 2 张房卡 ' }],
      });

      expect(result.status).toBe('completed');
      expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaService.$executeRaw).toHaveBeenCalledTimes(1);
      expect(
        handoverConfirmShiftService.ensureShiftNotHandedOver,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          storeHandoverRecord: expect.any(Object),
        }),
        100,
        expect.objectContaining({ id: 201 }),
        confirmedAt,
      );
      expect(prismaService.storeHandoverRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storeId: 100,
            fromEmployeeId: 20,
            toEmployeeId: 30,
            fromSubAccountId: 5,
            toSubAccountId: 6,
            status: HandoverStatus.completed,
            note: '完成交班',
            employeeShiftIdSnapshot: 201,
            fromEmployeeNameSnapshot: '员工A',
            shiftTypeSnapshot: EmployeeShiftType.morning,
            shiftStartTimeSnapshot: '09:00',
            shiftEndTimeSnapshot: '17:00',
            additionalValues: {
              create: [{ itemId: 101, value: '2 张房卡' }],
            },
          }),
        }),
      );
    });

    it('主账号自交班模式：不指定接收人', async () => {
      handoverAdditionalItemsService.resolveConfirmAdditionalItems.mockResolvedValue(
        [],
      );
      const confirmedAt = new Date(2026, 4, 13, 12, 0, 0);
      prismaService.storeHandoverRecord.create.mockResolvedValue({
        id: 10,
        storeId: 100,
        fromEmployeeId: 20,
        toEmployeeId: null,
        fromSubAccountId: null,
        toSubAccountId: null,
        actorStaffId: 1,
        fromEmployeeNameSnapshot: '员工A',
        shiftTypeSnapshot: EmployeeShiftType.morning,
        shiftNameSnapshot: null,
        shiftStartTimeSnapshot: '09:00',
        shiftEndTimeSnapshot: '17:00',
        handoverMode: HandoverMode.self_main_account,
        status: HandoverStatus.completed,
        handoverAt: confirmedAt,
        note: null,
        reason: null,
        createdAt: new Date(2026, 4, 13, 10, 0, 0),
        updatedAt: new Date(2026, 4, 13, 10, 0, 0),
        fromEmployee: { id: 10, name: '老板' },
        toEmployee: null,
        additionalValues: [],
      });

      const ownerUser = {
        ...subAccountUser,
        id: 1,
        currentMembership: {
          ...subAccountUser.currentMembership!,
          subjectType: 'owner' as const,
          linkedEmployeeId: 10,
          subAccountId: null,
        },
      };

      const result = await service.confirmHandover(ownerUser, {
        shiftType: 'morning',
        confirmedAt: confirmedAt.getTime(),
        additionalItems: [],
      });

      expect(result.handoverMode).toBe('self_main_account');
      expect(result.toEmployeeId).toBeNull();
      expect(prismaService.storeHandoverRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromEmployeeId: 20,
            fromSubAccountId: null,
          }),
        }),
      );
      expect(prismaService.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('同一班次重复交班时应抛出异常', async () => {
      handoverAdditionalItemsService.resolveConfirmAdditionalItems.mockResolvedValue(
        [],
      );
      handoverConfirmShiftService.ensureShiftNotHandedOver.mockRejectedValue(
        new Error('当前班次已完成交班，暂不允许重复操作'),
      );

      await expect(
        service.confirmHandover(subAccountUser, {
          shiftType: 'morning',
          confirmedAt: new Date('2026-05-13T12:00:00.000Z').getTime(),
          additionalItems: [],
        }),
      ).rejects.toThrow('当前班次已完成交班，暂不允许重复操作');
      expect(prismaService.storeHandoverRecord.create).not.toHaveBeenCalled();
      expect(prismaService.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('自定义班次会优先按 shiftReferenceAt 与 operatorName 锁定并写入快照', async () => {
      const handoverAt = new Date('2026-06-05T16:20:00.000Z');
      handoverConfirmShiftService.findSourceShiftRecord.mockResolvedValue({
        id: 901,
        employeeId: 20,
        employeeName: '收银员1',
        shiftType: EmployeeShiftType.custom,
        shiftName: '新早班',
        date: new Date('2026-06-05T00:00:00.000Z'),
        startTime: '16:01',
        endTime: '17:03',
        createdAt: new Date('2026-06-05T16:05:00.000Z'),
      });
      handoverConfirmShiftService.resolveReceiverCandidate.mockResolvedValue({
        employeeId: 30,
        employeeName: '收银员2',
        subAccountId: 6,
      });
      handoverAdditionalItemsService.resolveConfirmAdditionalItems.mockResolvedValue(
        [],
      );
      prismaService.storeHandoverRecord.create.mockResolvedValue({
        id: 11,
        storeId: 100,
        fromEmployeeId: 20,
        toEmployeeId: 30,
        fromSubAccountId: 5,
        toSubAccountId: 6,
        actorStaffId: 2,
        employeeShiftIdSnapshot: 901,
        fromEmployeeNameSnapshot: '收银员1',
        shiftTypeSnapshot: EmployeeShiftType.custom,
        shiftNameSnapshot: '新早班',
        shiftStartTimeSnapshot: '16:01',
        shiftEndTimeSnapshot: '17:03',
        handoverMode: HandoverMode.sub_account,
        status: HandoverStatus.completed,
        handoverAt,
        note: null,
        reason: null,
        createdAt: handoverAt,
        updatedAt: handoverAt,
        fromEmployee: { id: 20, name: '收银员1' },
        toEmployee: { id: 30, name: '收银员2' },
        additionalValues: [],
      });

      await service.confirmHandover(subAccountUser, {
        shiftType: EmployeeShiftType.custom,
        shiftReferenceAt: new Date('2026-06-05T16:01:00.000Z').getTime(),
        operatorName: '收银员1',
        confirmedAt: handoverAt.getTime(),
        additionalItems: [],
      });

      expect(prismaService.storeHandoverRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromEmployeeId: 20,
            toEmployeeId: 30,
            employeeShiftIdSnapshot: 901,
            fromEmployeeNameSnapshot: '收银员1',
            shiftTypeSnapshot: EmployeeShiftType.custom,
            shiftNameSnapshot: '新早班',
            shiftStartTimeSnapshot: '16:01',
            shiftEndTimeSnapshot: '17:03',
          }),
        }),
      );
    });
  });
});
