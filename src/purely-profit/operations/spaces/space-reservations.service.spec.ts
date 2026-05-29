import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpaceReservationsService } from './space-reservations.service';

describe('SpaceReservationsService', () => {
  let service: SpaceReservationsService;

  const prismaService = {
    space: {
      findUnique: jest.fn(),
    },
    spaceReservation: {
      findMany: jest.fn(),
    },
  };

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
    resolveViewStoreId: jest.fn(),
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
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceReservationsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
      ],
    }).compile();

    service = module.get<SpaceReservationsService>(SpaceReservationsService);
  });

  it('listStoreSpaceReservations 在未传 status 时默认只返回 pending 预约', async () => {
    prismaService.spaceReservation.findMany.mockResolvedValue([]);

    await service.listStoreSpaceReservations(user, {});

    expect(commerceAccessService.resolveViewStoreId).toHaveBeenCalledWith(
      user,
      undefined,
      'space:view',
      '无权查看该门店空间预约',
    );
    expect(prismaService.spaceReservation.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        status: PrismaSpaceReservationStatus.pending,
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('listStoreSpaceReservations 在显式传 status 时保留调用方筛选条件', async () => {
    prismaService.spaceReservation.findMany.mockResolvedValue([]);

    await service.listStoreSpaceReservations(user, {
      status: 'cancelled',
    });

    expect(prismaService.spaceReservation.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        status: PrismaSpaceReservationStatus.cancelled,
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('listStoreSpaceReservations 在开始时间晚于结束时间时抛出异常', async () => {
    await expect(
      service.listStoreSpaceReservations(user, {
        dateFrom: 200,
        dateTo: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaService.spaceReservation.findMany).not.toHaveBeenCalled();
  });

  it('listSpaceReservations 在未传 status 时默认只返回某空间的 pending 预约', async () => {
    prismaService.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
    });
    prismaService.spaceReservation.findMany.mockResolvedValue([]);

    await service.listSpaceReservations(user, 11, {});

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'space:view',
      '无权查看该门店空间预约',
    );
    expect(prismaService.spaceReservation.findMany).toHaveBeenCalledWith({
      where: {
        spaceId: 11,
        status: PrismaSpaceReservationStatus.pending,
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('toSpaceReservationResponse 会标记已过时预约', () => {
    const result = service.toSpaceReservationResponse({
      id: 9,
      spaceId: 11,
      guestName: '张先生',
      phone: '13800138000',
      reservedAt: new Date(Date.now() - 60_000),
      reservedEndAt: new Date(Date.now() + 60_000),
      guestCount: 4,
      note: '生日聚会',
      status: PrismaSpaceReservationStatus.pending,
      createdAt: new Date('2026-05-18T10:00:00.000Z'),
      updatedAt: new Date('2026-05-18T10:10:00.000Z'),
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: '9',
        spaceId: '11',
        status: 'pending',
        isOverdue: true,
      }),
    );
  });
});
