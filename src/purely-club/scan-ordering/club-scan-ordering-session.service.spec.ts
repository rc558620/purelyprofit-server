import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubStoreAccessService } from '../stores/club-store-access.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubScanOrderingQrTokenService } from './club-scan-ordering-qr-token.service';
import { ClubScanOrderingSessionService } from './club-scan-ordering-session.service';

/**
 * 桌台会话建立测试。
 *
 * 覆盖 createOrRestoreSession() 的入店副作用：桌码链路必须同时补齐门店会员关系
 * 并把「当前门店」切到桌台所属门店，否则商家端看不到顾客、以当前门店为前提的
 * 接口会 404、点餐历史按错门店过滤。
 */
describe('ClubScanOrderingSessionService - createOrRestoreSession', () => {
  let service: ClubScanOrderingSessionService;

  const prismaService = {
    scanOrderingTable: {
      findFirst: jest.fn(),
    },
    scanOrderingSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const qrTokenService = {
    consumeScanToken: jest.fn(),
  };

  const storeAccessService = {
    ensureStoreMembership: jest.fn(),
  };

  /** 当前门店上下文：桌码进店即入店，建会话时必须把当前门店切到桌台所属门店 */
  const currentStoreContextService = {
    switchCurrentStore: jest.fn().mockResolvedValue({ id: 100 }),
  };

  const user: AuthenticatedUser = {
    id: 215,
    email: 'club_wechat_o6Al43fTTP77c@purelyprofit.local',
    phone: 'club_wechat:o6Al43fTTP77c',
    name: null,
    createdAt: new Date('2026-09-18T00:00:00.000Z'),
    updatedAt: new Date('2026-09-18T00:00:00.000Z'),
    lastActiveAt: null,
    accountScope: 'purely_club',
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingSessionService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: ClubScanOrderingQrTokenService,
          useValue: qrTokenService,
        },
        {
          provide: ClubStoreAccessService,
          useValue: storeAccessService,
        },
        {
          provide: ClubCurrentStoreContextService,
          useValue: currentStoreContextService,
        },
      ],
    }).compile();
    service = module.get<ClubScanOrderingSessionService>(
      ClubScanOrderingSessionService,
    );
  });

  const prepareSessionCreation = (): void => {
    qrTokenService.consumeScanToken.mockResolvedValue({
      storeId: 100,
      tableId: 1,
    });
    prismaService.scanOrderingTable.findFirst.mockResolvedValue({
      id: 1,
      tableCode: 'T001',
      name: '1号桌',
      capacity: 4,
      status: 'available',
      area: { name: '大厅' },
      type: null,
    });
    prismaService.scanOrderingSession.updateMany.mockResolvedValue({
      count: 0,
    });
    prismaService.scanOrderingSession.findFirst.mockResolvedValue(null);
    prismaService.scanOrderingSession.create.mockResolvedValue({
      id: 295,
      guestCount: 1,
      status: 'active',
      expiresAt: new Date(),
      diningRoundId: '7f1c2f52-7a1f-4a1e-9f2a-3f0a1b2c3d4e',
    });
  };

  it('按桌码门店补齐会员关系，否则商家端看不到顾客且以当前门店为前提的接口会 404', async () => {
    prepareSessionCreation();
    storeAccessService.ensureStoreMembership.mockResolvedValue({
      isNewMember: true,
    });

    await service.createOrRestoreSession(user, { scanToken: 'scan-token' });

    expect(storeAccessService.ensureStoreMembership).toHaveBeenCalledWith(
      user,
      100,
    );
  });

  it('桌码进店即入店：把当前门店切到桌台所属门店', async () => {
    prepareSessionCreation();
    storeAccessService.ensureStoreMembership.mockResolvedValue({
      isNewMember: true,
    });

    await service.createOrRestoreSession(user, { scanToken: 'scan-token' });

    expect(currentStoreContextService.switchCurrentStore).toHaveBeenCalledWith(
      user,
      100,
    );
  });

  it('会员关系补齐失败时直接失败，不创建会话', async () => {
    prepareSessionCreation();
    storeAccessService.ensureStoreMembership.mockRejectedValue(
      new NotFoundException('门店不存在'),
    );

    await expect(
      service.createOrRestoreSession(user, { scanToken: 'scan-token' }),
    ).rejects.toThrow(NotFoundException);

    expect(prismaService.scanOrderingSession.create).not.toHaveBeenCalled();
  });

  it('桌台不可点餐时不创建会话', async () => {
    prepareSessionCreation();
    prismaService.scanOrderingTable.findFirst.mockResolvedValue({
      id: 1,
      tableCode: 'T001',
      name: '1号桌',
      capacity: 4,
      status: 'clearing',
      area: { name: '大厅' },
      type: null,
    });

    await expect(
      service.createOrRestoreSession(user, { scanToken: 'scan-token' }),
    ).rejects.toThrow(ConflictException);

    expect(prismaService.scanOrderingSession.create).not.toHaveBeenCalled();
  });
});
