import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { SpaceSessionCheckoutService } from './space-session-checkout.service';
import { SpaceSessionOpenService } from './space-session-open.service';
import { SpaceSessionReadService } from './space-session-read.service';
import { SpaceSessionRenewService } from './space-session-renew.service';
import { SpaceSessionTransferService } from './space-session-transfer.service';
import { SpaceSessionWriteService } from './space-session-write.service';
import { SpaceSessionsService } from './space-sessions.service';

describe('SpaceSessionsService', () => {
  let service: SpaceSessionsService;

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
  };

  const readService = {
    listStoreSpaceSessions: jest.fn(),
    listStoreActiveSpaceSessions: jest.fn(),
    getActiveSpaceSession: jest.fn(),
    listSpaceSessions: jest.fn(),
    getSpaceSessionDetail: jest.fn(),
  };

  const checkoutService = {
    previewSpaceSessionCheckout: jest.fn(),
    checkoutSpaceSession: jest.fn(),
  };

  const openService = {
    openSession: jest.fn(),
  };

  const renewService = {
    renewSession: jest.fn(),
  };

  const transferService = {
    transferSession: jest.fn(),
  };

  const writeService = {
    addItemsToSession: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionsService,
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: SpaceSessionReadService, useValue: readService },
        { provide: SpaceSessionCheckoutService, useValue: checkoutService },
        { provide: SpaceSessionOpenService, useValue: openService },
        { provide: SpaceSessionRenewService, useValue: renewService },
        { provide: SpaceSessionTransferService, useValue: transferService },
        { provide: SpaceSessionWriteService, useValue: writeService },
      ],
    }).compile();

    service = module.get<SpaceSessionsService>(SpaceSessionsService);
  });

  it('listStoreSpaceSessions 代理给 readService', async () => {
    readService.listStoreSpaceSessions.mockResolvedValue([]);

    await service.listStoreSpaceSessions(user, { status: 'active' });

    expect(readService.listStoreSpaceSessions).toHaveBeenCalledWith(
      user,
      {
        status: 'active',
      },
      undefined,
    );
  });

  it('previewSpaceSessionCheckout 代理给 checkoutService', async () => {
    const dto = { timeFeeMode: 'timed' as const };
    checkoutService.previewSpaceSessionCheckout.mockResolvedValue({
      lockId: 'lock_1',
      lockedAt: 1,
      expiresAt: 2,
      preview: {
        durationMinutes: 30,
        durationLabel: '30分钟',
        timeCost: 10,
        itemsCost: 0,
        renewDeduction: 0,
        prepaidDeduction: 0,
        totalAmount: 10,
        timeFeeMode: 'timed',
      },
    });

    await service.previewSpaceSessionCheckout(user, 9, dto);

    expect(checkoutService.previewSpaceSessionCheckout).toHaveBeenCalledWith(
      user,
      9,
      dto,
    );
  });

  it('openSpaceSession 代理给 openService', async () => {
    const dto = { billingMode: 'timed' as const, hourlyRate: 68 };
    openService.openSession.mockResolvedValue({ id: '1' });

    await service.openSpaceSession(user, 7, dto);

    expect(openService.openSession).toHaveBeenCalledWith(user, 7, dto);
  });

  it('checkoutSpaceSession 代理给 checkoutService', async () => {
    const dto = {
      paymentMethod: 'cash' as const,
      lockId: 'lock_1',
      lockedAt: Date.now(),
    };
    checkoutService.checkoutSpaceSession.mockResolvedValue({
      session: { id: '1' },
      spaceStatus: 'idle',
      salesOrder: { id: '2' },
    });

    await service.checkoutSpaceSession(user, 9, dto);

    expect(checkoutService.checkoutSpaceSession).toHaveBeenCalledWith(
      user,
      9,
      dto,
    );
  });
});
