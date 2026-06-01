import { HandoverMode, HandoverStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmService } from './handover-confirm.service';
import {
  createHandoverPrismaMock,
  createMockCandidates,
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

  const subAccountUser = createSubAccountUser();
  const mockCandidates = createMockCandidates();

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
      ],
    }).compile();

    service = module.get<HandoverConfirmService>(HandoverConfirmService);
  });

  describe('confirmHandover', () => {
    it('会创建已完成的交班记录并保存附加项', async () => {
      storeSubAccountService.listAssignableHandoverCandidates.mockResolvedValue(
        mockCandidates,
      );
      handoverAdditionalItemsService.resolveConfirmAdditionalItems.mockResolvedValue(
        [{ id: 101, value: '2 张房卡' }],
      );
      prismaService.storeHandoverRecord.create.mockResolvedValue({
        id: 9,
        storeId: 100,
        fromEmployeeId: 20,
        toEmployeeId: 30,
        fromSubAccountId: 5,
        toSubAccountId: 6,
        actorStaffId: 2,
        handoverMode: HandoverMode.sub_account,
        status: HandoverStatus.completed,
        handoverAt: new Date('2026-05-13T12:00:00.000Z'),
        note: '完成交班',
        reason: null,
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
        updatedAt: new Date('2026-05-13T10:00:00.000Z'),
        fromEmployee: { id: 20, name: '员工A' },
        toEmployee: { id: 30, name: '经理' },
      });

      const result = await service.confirmHandover(subAccountUser, {
        shiftType: 'morning',
        handedOverAt: new Date('2026-05-13T12:00:00.000Z').getTime(),
        note: '  完成交班  ',
        additionalItems: [{ id: 101, value: ' 2 张房卡 ' }],
      });

      expect(result.status).toBe('completed');
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
      prismaService.storeHandoverRecord.create.mockResolvedValue({
        id: 10,
        storeId: 100,
        fromEmployeeId: 10,
        toEmployeeId: null,
        fromSubAccountId: null,
        toSubAccountId: null,
        actorStaffId: 1,
        handoverMode: HandoverMode.self_main_account,
        status: HandoverStatus.completed,
        handoverAt: new Date('2026-05-13T12:00:00.000Z'),
        note: null,
        reason: null,
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
        updatedAt: new Date('2026-05-13T10:00:00.000Z'),
        fromEmployee: { id: 10, name: '老板' },
        toEmployee: null,
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
        handedOverAt: Date.now(),
        additionalItems: [],
      });

      expect(result.handoverMode).toBe('self_main_account');
      expect(result.toEmployeeId).toBeNull();
    });
  });
});
