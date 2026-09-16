import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubServiceCallService } from './club-service-call.service';
import { ServiceCallRealtimeService } from './service-call-realtime.service';

describe('ClubServiceCallService', () => {
  let service: ClubServiceCallService;

  const prisma = {
    serviceCall: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const currentStoreContextService = {
    requireCurrentContext: jest.fn(),
  };
  const realtimeService = {
    publishCreated: jest.fn(),
  };
  const user = {
    id: 7,
    email: 'club@example.com',
    phone: '13800138000',
    name: 'Club 用户',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubServiceCallService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ClubCurrentStoreContextService,
          useValue: currentStoreContextService,
        },
        { provide: ServiceCallRealtimeService, useValue: realtimeService },
      ],
    }).compile();
    service = module.get(ClubServiceCallService);
  });

  it('uses the server-validated current store and publishes a complete notification payload', async () => {
    currentStoreContextService.requireCurrentContext.mockResolvedValue({
      store: { id: 42 },
    });
    prisma.serviceCall.findFirst.mockResolvedValue(null);
    const createdAt = new Date('2026-07-28T12:00:00.000Z');
    prisma.serviceCall.create.mockResolvedValue({
      id: 9,
      storeId: 42,
      source: 'club_home',
      type: 'assistance',
      status: 'pending',
      locationLabel: null,
      remark: '需要协助',
      relatedOrderId: null,
      createdAt,
    });

    await service.createFromHome(user, {
      storeId: 42,
      type: 'assistance',
      remark: '需要协助',
    });

    expect(
      currentStoreContextService.requireCurrentContext,
    ).toHaveBeenCalledWith(user, 42);
    expect(realtimeService.publishCreated).toHaveBeenCalledWith({
      id: 9,
      storeId: 42,
      source: 'club_home',
      type: 'assistance',
      status: 'pending',
      locationLabel: null,
      remark: '需要协助',
      relatedOrderId: null,
      createdAt: createdAt.toISOString(),
    });
  });

  it('rejects a duplicate open call inside the cooldown window', async () => {
    currentStoreContextService.requireCurrentContext.mockResolvedValue({
      store: { id: 42 },
    });
    // 冷却期内（60s）重复呼叫：既不新建也不续推，直接拒绝
    prisma.serviceCall.findFirst.mockResolvedValue({
      id: 8,
      lastRequestedAt: new Date(),
    });

    await expect(
      service.createFromHome(user, { storeId: 42, type: 'assistance' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.serviceCall.create).not.toHaveBeenCalled();
    expect(prisma.serviceCall.update).not.toHaveBeenCalled();
    expect(realtimeService.publishCreated).not.toHaveBeenCalled();
  });

  it('reminds the existing open call after the cooldown window', async () => {
    currentStoreContextService.requireCurrentContext.mockResolvedValue({
      store: { id: 42 },
    });
    const lastRequestedAt = new Date(Date.now() - 2 * 60 * 1000);
    prisma.serviceCall.findFirst.mockResolvedValue({
      id: 8,
      lastRequestedAt,
    });
    prisma.serviceCall.update.mockResolvedValue({
      id: 8,
      storeId: 42,
      clubUserId: user.id,
      source: 'club_home',
      type: 'assistance',
      status: 'pending',
      locationLabel: null,
      remark: '仍然需要协助',
      relatedOrderId: null,
      reminderCount: 2,
      createdAt: lastRequestedAt,
    });

    await service.createFromHome(user, {
      storeId: 42,
      type: 'assistance',
      remark: '仍然需要协助',
    });

    expect(prisma.serviceCall.create).not.toHaveBeenCalled();
    expect(prisma.serviceCall.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8 },
        data: expect.objectContaining({ reminderCount: { increment: 1 } }),
      }),
    );
    expect(realtimeService.publishCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8, reminderCount: 2 }),
    );
  });
});
