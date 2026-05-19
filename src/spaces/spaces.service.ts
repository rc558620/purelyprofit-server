import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import {
  buildPaginationMeta,
  resolvePagination,
  toTimestampMs,
} from '../commerce/commerce.utils';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SalesRecordService } from '../sales-record/sales-record.service';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from '../sales-record/dto/sales-record.dto';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
import {
  CreateSpaceDto,
  GetSpacesDashboardQueryDto,
  ListSpacesQueryDto,
  type SpaceDashboardActiveSessionSummaryDto,
  type SpaceDashboardFilterOptionsDto,
  type SpaceDashboardReservationSummaryDto,
  type SpaceDashboardSpaceItemDto,
  type SpaceResponseDto,
  type SpaceStatsResponseDto,
  type SpacesDashboardResponseDto,
  UpdateSpaceDto,
  UpdateSpaceStatusDto,
} from './dto/space.dto';
import {
  CreateSpaceTypeDto,
  ListSpaceTypesQueryDto,
  type SpaceTypeResponseDto,
  UpdateSpaceTypeDto,
} from './dto/space-type.dto';
import {
  CreateSpaceZoneDto,
  ListSpaceZonesQueryDto,
  type SpaceZoneResponseDto,
  UpdateSpaceZoneDto,
} from './dto/space-zone.dto';
import {
  CreateSpaceReservationDto,
  ListSpaceReservationsQueryDto,
  type SpaceReservationResponseDto,
  UpdateSpaceReservationDto,
} from './dto/space-reservation.dto';
import {
  AddSpaceSessionItemsDto,
  CheckoutSpaceSessionDto,
  CheckoutSpaceSessionPreviewDto,
  type CheckoutSpaceSessionPreviewResponseDto,
  type CheckoutSpaceSessionResponseDto,
  ListSpaceSessionsQueryDto,
  OpenSpaceSessionDto,
  type PaginatedSpaceSessionsResponseDto,
  RenewSpaceSessionDto,
  type RenewSpaceSessionResponseDto,
  type SpaceCountdownFeeModeValue,
  type SpaceSessionItemResponseDto,
  type SpaceSessionRenewRecordResponseDto,
  type SpaceSessionResponseDto,
  TransferSpaceSessionDto,
  type TransferSpaceSessionResponseDto,
} from './dto/space-session.dto';
import type {
  SpaceBillingModeValue,
  SpaceReservationStatusValue,
  SpaceSessionStatusValue,
  SpaceStatusValue,
} from './spaces.constants';

interface SpaceTypeRecord {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SpaceZoneRecord {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SpaceReservationRecord {
  id: number;
  spaceId: number;
  guestName: string;
  phone: string | null;
  reservedAt: Date;
  reservedEndAt: Date | null;
  guestCount: number | null;
  note: string | null;
  status: PrismaSpaceReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface SpaceSessionItemRecord {
  productId: string;
  productName: string;
  categoryName: string;
  salePrice: number;
  profit: number;
  quantity: number;
}

interface SpaceSessionRenewRecord {
  id: string;
  amount: number;
  addedMinutes: number;
  paymentMethod: SalesPaymentMethodValue;
  grouponCode?: string;
  grouponPlatform?: string;
  note?: string;
  renewedAt: number;
}

interface SpaceSessionRecord {
  id: number;
  spaceId: number;
  space: {
    id: number;
    name: string;
    type: {
      name: string;
    };
  };
  reservationId: number | null;
  guestName: string | null;
  guestPhone: string | null;
  guestCount: number | null;
  startTime: Date;
  endTime: Date | null;
  billingMode: PrismaSpaceBillingMode;
  hourlyRate: Prisma.Decimal | null;
  timeCost: Prisma.Decimal | null;
  countdownMinutes: number | null;
  autoCheckout: boolean | null;
  prepaidPaymentMethod: SalesPaymentMethodValue | null;
  prepaidGrouponCode: string | null;
  prepaidNote: string | null;
  prepaidAmount: Prisma.Decimal | null;
  items: Prisma.JsonValue;
  itemsCost: Prisma.Decimal;
  renewRecords: Prisma.JsonValue;
  status: PrismaSpaceSessionStatus;
  saleOrderId: number | null;
  createdAt: Date;
}

interface DashboardSpaceSummaryBundle {
  activeSessionSummaryBySpaceId: Map<
    number,
    SpaceDashboardActiveSessionSummaryDto
  >;
  activeReservationSummaryBySpaceId: Map<
    number,
    SpaceDashboardReservationSummaryDto
  >;
  futureReservationSummaryBySpaceId: Map<
    number,
    SpaceDashboardReservationSummaryDto
  >;
}

interface SpaceSessionListQuery {
  page?: number;
  pageSize?: number;
  status?: SpaceSessionStatusValue;
  includeActive?: boolean;
  keyword?: string;
  rangeStartDate?: number;
  rangeEndDate?: number;
}

type SpaceWithRelations = {
  id: number;
  name: string;
  capacity: number | null;
  enableDirtyRoom: boolean;
  autoCheckout: boolean;
  status: PrismaSpaceStatus;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  type: {
    id: number;
    name: string;
  };
  zone: {
    id: number;
    name: string;
  } | null;
};

const SPACE_SESSION_CHECKOUT_LOCK_TTL_SECONDS = 5 * 60;

interface SpaceSessionCheckoutLockPayload {
  sessionId: number;
  lockedAt: number;
  expiresAt: number;
  countdownFeeMode?: SpaceCountdownFeeModeValue;
}

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly salesRecordService: SalesRecordService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async listSpaceTypes(
    user: AuthenticatedUser,
    query: ListSpaceTypesQueryDto,
  ): Promise<SpaceTypeResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间类型',
    );

    if (storeId === null) {
      return [];
    }

    const items = await this.prisma.spaceType.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceTypeResponse(item));
  }

  async createSpaceType(
    user: AuthenticatedUser,
    dto: CreateSpaceTypeDto,
  ): Promise<SpaceTypeResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'space:create',
      '无权操作该门店空间类型',
    );
    const name = dto.name.trim();

    const duplicate = await this.prisma.spaceType.findFirst({
      where: { storeId, name },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('空间类型名称已存在');
    }

    const item = await this.prisma.spaceType.create({
      data: { storeId, name },
    });

    return this.toSpaceTypeResponse(item);
  }

  async updateSpaceType(
    user: AuthenticatedUser,
    typeId: number,
    dto: UpdateSpaceTypeDto,
  ): Promise<SpaceTypeResponseDto> {
    const item = await this.prisma.spaceType.findUnique({
      where: { id: typeId },
    });

    if (!item) {
      throw new NotFoundException('空间类型不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:update',
      '无权操作该门店空间类型',
    );

    const name = dto.name.trim();
    if (name !== item.name) {
      const duplicate = await this.prisma.spaceType.findFirst({
        where: {
          storeId: item.storeId,
          name,
          id: { not: item.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException('空间类型名称已存在');
      }
    }

    const updated = await this.prisma.spaceType.update({
      where: { id: item.id },
      data: { name },
    });

    return this.toSpaceTypeResponse(updated);
  }

  async removeSpaceType(
    user: AuthenticatedUser,
    typeId: number,
  ): Promise<void> {
    const item = await this.prisma.spaceType.findUnique({
      where: { id: typeId },
      select: {
        id: true,
        storeId: true,
        _count: {
          select: { spaces: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('空间类型不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:delete',
      '无权删除该门店空间类型',
    );

    if (item._count.spaces > 0) {
      throw new ConflictException('该空间类型已被空间使用，无法删除');
    }

    await this.prisma.spaceType.delete({
      where: { id: item.id },
    });
  }

  async listSpaceZones(
    user: AuthenticatedUser,
    query: ListSpaceZonesQueryDto,
  ): Promise<SpaceZoneResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间区域',
    );

    if (storeId === null) {
      return [];
    }

    const items = await this.prisma.spaceZone.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceZoneResponse(item));
  }

  async createSpaceZone(
    user: AuthenticatedUser,
    dto: CreateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'space:create',
      '无权操作该门店空间区域',
    );
    const name = dto.name.trim();

    const duplicate = await this.prisma.spaceZone.findFirst({
      where: { storeId, name },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('空间区域名称已存在');
    }

    const item = await this.prisma.spaceZone.create({
      data: { storeId, name },
    });

    return this.toSpaceZoneResponse(item);
  }

  async updateSpaceZone(
    user: AuthenticatedUser,
    zoneId: number,
    dto: UpdateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    const item = await this.prisma.spaceZone.findUnique({
      where: { id: zoneId },
    });

    if (!item) {
      throw new NotFoundException('空间区域不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:update',
      '无权操作该门店空间区域',
    );

    const name = dto.name.trim();
    if (name !== item.name) {
      const duplicate = await this.prisma.spaceZone.findFirst({
        where: {
          storeId: item.storeId,
          name,
          id: { not: item.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException('空间区域名称已存在');
      }
    }

    const updated = await this.prisma.spaceZone.update({
      where: { id: item.id },
      data: { name },
    });

    return this.toSpaceZoneResponse(updated);
  }

  async removeSpaceZone(
    user: AuthenticatedUser,
    zoneId: number,
  ): Promise<void> {
    const item = await this.prisma.spaceZone.findUnique({
      where: { id: zoneId },
      select: {
        id: true,
        storeId: true,
        _count: {
          select: { spaces: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('空间区域不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:delete',
      '无权删除该门店空间区域',
    );

    if (item._count.spaces > 0) {
      throw new ConflictException('该空间区域已被空间使用，无法删除');
    }

    await this.prisma.spaceZone.delete({
      where: { id: item.id },
    });
  }

  async getSpacesDashboard(
    user: AuthenticatedUser,
    query: GetSpacesDashboardQueryDto,
  ): Promise<SpacesDashboardResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间看板',
    );

    if (storeId === null) {
      return this.buildEmptyDashboard();
    }

    const [spaces, sessionStats, dashboardSummaries] = await Promise.all([
      this.findSpacesByStore(storeId),
      this.buildTodaySettledSessionStats(storeId),
      this.buildDashboardSpaceSummaryBundle(storeId),
    ]);

    return {
      stats: this.buildSpaceStats(spaces, sessionStats),
      filterOptions: this.buildFilterOptions(spaces),
      spaces: spaces.map((space) =>
        this.toSpaceDashboardItem(space, dashboardSummaries),
      ),
    };
  }

  async listSpaces(
    user: AuthenticatedUser,
    query: ListSpacesQueryDto,
  ): Promise<SpaceResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间列表',
    );

    if (storeId === null) {
      return [];
    }

    const where: Prisma.SpaceWhereInput = {
      storeId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type
        ? {
            type: {
              is: {
                name: query.type.trim(),
              },
            },
          }
        : {}),
      ...(query.zone
        ? {
            zone: {
              is: {
                name: query.zone.trim(),
              },
            },
          }
        : {}),
    };

    const spaces = await this.prisma.space.findMany({
      where,
      include: {
        type: {
          select: {
            id: true,
            name: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return spaces.map((space) => this.toSpaceResponse(space));
  }

  async createSpace(
    user: AuthenticatedUser,
    dto: CreateSpaceDto,
  ): Promise<SpaceResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'space:create',
      '无权操作该门店空间',
    );
    const name = dto.name.trim();

    const duplicate = await this.prisma.space.findFirst({
      where: { storeId, name },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('空间名称已存在');
    }

    const type = await this.requireSpaceTypeByName(storeId, dto.type);
    const zone = await this.findSpaceZoneByName(storeId, dto.zone);

    const created = await this.prisma.$transaction(async (transaction) => {
      const existingCount = await transaction.space.count({
        where: { storeId },
      });
      const targetSortOrder = this.normalizeTargetSortOrder(
        dto.sortOrder,
        existingCount + 1,
      );

      await transaction.space.updateMany({
        where: {
          storeId,
          sortOrder: {
            gte: targetSortOrder,
          },
        },
        data: {
          sortOrder: {
            increment: 1,
          },
        },
      });

      return transaction.space.create({
        data: {
          storeId,
          typeId: type.id,
          zoneId: zone?.id ?? null,
          name,
          capacity: dto.capacity,
          enableDirtyRoom: dto.enableDirtyRoom,
          autoCheckout: dto.autoCheckout,
          status: PrismaSpaceStatus.idle,
          sortOrder: targetSortOrder,
        },
        include: {
          type: {
            select: {
              id: true,
              name: true,
            },
          },
          zone: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    return this.toSpaceResponse(created);
  }

  async updateSpace(
    user: AuthenticatedUser,
    spaceId: number,
    dto: UpdateSpaceDto,
  ): Promise<SpaceResponseDto> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      include: {
        type: {
          select: {
            id: true,
            name: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:update',
      '无权操作该门店空间',
    );

    const nextName = dto.name?.trim();
    if (nextName && nextName !== space.name) {
      const duplicate = await this.prisma.space.findFirst({
        where: {
          storeId: space.storeId,
          name: nextName,
          id: { not: space.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException('空间名称已存在');
      }
    }

    const nextType = dto.type
      ? await this.requireSpaceTypeByName(space.storeId, dto.type)
      : null;
    const nextZone =
      dto.zone !== undefined
        ? await this.findSpaceZoneByName(space.storeId, dto.zone)
        : null;

    const updated = await this.prisma.$transaction(async (transaction) => {
      if (dto.sortOrder !== undefined && dto.sortOrder !== space.sortOrder) {
        await this.reorderSpaceSortOrder(
          transaction,
          space.storeId,
          space.id,
          space.sortOrder,
          dto.sortOrder,
        );
      }

      return transaction.space.update({
        where: { id: space.id },
        data: {
          ...(nextName ? { name: nextName } : {}),
          ...(dto.type !== undefined ? { typeId: nextType?.id } : {}),
          ...(dto.zone !== undefined ? { zoneId: nextZone?.id ?? null } : {}),
          ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
          ...(dto.enableDirtyRoom !== undefined
            ? { enableDirtyRoom: dto.enableDirtyRoom }
            : {}),
          ...(dto.autoCheckout !== undefined
            ? { autoCheckout: dto.autoCheckout }
            : {}),
          ...(dto.sortOrder !== undefined
            ? {
                sortOrder: this.normalizeTargetSortOrder(
                  dto.sortOrder,
                  await transaction.space.count({
                    where: { storeId: space.storeId },
                  }),
                ),
              }
            : {}),
        },
        include: {
          type: {
            select: {
              id: true,
              name: true,
            },
          },
          zone: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    return this.toSpaceResponse(updated);
  }

  async markSpaceReady(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceResponseDto> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      include: {
        type: {
          select: {
            id: true,
            name: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:update',
      '无权操作该门店空间',
    );

    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextStatus = await this.resolveReservationBackStatus(
        transaction,
        space.id,
      );

      return transaction.space.update({
        where: { id: space.id },
        data: {
          status: nextStatus,
        },
        include: {
          type: {
            select: {
              id: true,
              name: true,
            },
          },
          zone: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    return this.toSpaceResponse(updated);
  }

  async updateSpaceStatus(
    user: AuthenticatedUser,
    spaceId: number,
    dto: UpdateSpaceStatusDto,
  ): Promise<SpaceResponseDto> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      include: {
        type: {
          select: {
            id: true,
            name: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:update',
      '无权操作该门店空间',
    );

    if (dto.status === PrismaSpaceStatus.occupied) {
      throw new ConflictException('使用中状态仅可通过开台、换房等会话流程更新');
    }

    if (space.status === PrismaSpaceStatus.occupied) {
      throw new ConflictException('空间当前使用中，请先完成会话流程后再调整状态');
    }

    const updated = await this.prisma.space.update({
      where: { id: space.id },
      data: {
        status: dto.status,
      },
      include: {
        type: {
          select: {
            id: true,
            name: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return this.toSpaceResponse(updated);
  }

  async listStoreSpaceSessions(
    user: AuthenticatedUser,
    queryDto: ListSpaceSessionsQueryDto,
  ): Promise<SpaceSessionResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      queryDto.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

    if (storeId === null) {
      return [];
    }

    const query = this.toSpaceSessionListQuery(queryDto);
    const normalizedQuery: SpaceSessionListQuery = {
      ...query,
      ...(query.status === undefined && query.includeActive === undefined
        ? { includeActive: true }
        : {}),
    };

    const where = this.buildStoreSpaceSessionListWhere(
      storeId,
      normalizedQuery,
    );

    const sessions = await this.prisma.spaceSession.findMany({
      where,
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    });

    return sessions.map((session) => this.toSpaceSessionResponse(session));
  }

  async getActiveSpaceSession(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceSessionResponseDto | null> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

    const session = await this.prisma.spaceSession.findFirst({
      where: {
        spaceId: space.id,
        status: PrismaSpaceSessionStatus.active,
      },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    });

    return session ? this.toSpaceSessionResponse(session) : null;
  }

  async listSpaceSessions(
    user: AuthenticatedUser,
    spaceId: number,
    queryDto: ListSpaceSessionsQueryDto,
  ): Promise<PaginatedSpaceSessionsResponseDto> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

    const query = this.toSpaceSessionListQuery(queryDto);
    const { page, skip, take } = this.resolvePageQuery(
      query.page,
      query.pageSize,
    );
    const where = this.buildSpaceSessionListWhere(space.id, query);

    const queryResult: [SpaceSessionRecord[], number] = await Promise.all([
      this.prisma.spaceSession.findMany({
        where,
        include: {
          space: {
            select: {
              id: true,
              name: true,
              type: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.spaceSession.count({ where }),
    ]);

    const [sessions, total] = queryResult;

    return {
      items: sessions.map((session) => this.toSpaceSessionResponse(session)),
      meta: buildPaginationMeta(total, page, take),
    };
  }

  async getSpaceSessionDetail(
    user: AuthenticatedUser,
    sessionId: number,
  ): Promise<SpaceSessionResponseDto> {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'space:view',
      '无权查看该门店空间会话',
    );

    return this.toSpaceSessionResponse(session);
  }

  async openSpaceSession(
    user: AuthenticatedUser,
    spaceId: number,
    dto: OpenSpaceSessionDto,
  ): Promise<SpaceSessionResponseDto> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      include: {
        type: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'sales:create',
      '无权在该门店空间开台',
    );

    if (space.status === PrismaSpaceStatus.occupied) {
      throw new ConflictException('空间当前使用中，无法重复开台');
    }

    if (space.status === PrismaSpaceStatus.cleaning) {
      throw new ConflictException('空间待清洁，暂时无法开台');
    }

    const payload = this.normalizeOpenSessionPayload(dto);
    this.ensureOpenSessionPayload(payload);

    if (payload.reservationId !== undefined) {
      await this.ensureReservationCanBeFulfilled(
        space.storeId,
        space.id,
        payload.reservationId,
      );
    }

    const session = await this.prisma.$transaction(async (transaction) => {
      const activeSession = await transaction.spaceSession.findFirst({
        where: {
          spaceId: space.id,
          status: PrismaSpaceSessionStatus.active,
        },
        select: {
          id: true,
        },
      });

      if (activeSession) {
        throw new ConflictException('空间当前使用中，无法重复开台');
      }

      if (payload.reservationId !== undefined) {
        await transaction.spaceReservation.update({
          where: { id: payload.reservationId },
          data: {
            status: PrismaSpaceReservationStatus.fulfilled,
          },
        });
      }

      const created = await transaction.spaceSession.create({
        data: {
          storeId: space.storeId,
          spaceId: space.id,
          reservationId: payload.reservationId,
          guestName: payload.guestName ?? null,
          guestPhone: payload.guestPhone ?? null,
          guestCount: payload.guestCount ?? null,
          startTime: new Date(),
          billingMode: this.toPrismaSpaceBillingMode(payload.billingMode),
          hourlyRate:
            payload.hourlyRate !== undefined
              ? new Prisma.Decimal(payload.hourlyRate)
              : null,
          countdownMinutes: payload.countdownMinutes ?? null,
          autoCheckout: payload.autoCheckout ?? null,
          prepaidPaymentMethod: payload.prepaidPaymentMethod ?? null,
          prepaidGrouponCode: payload.prepaidGrouponCode ?? null,
          prepaidNote: payload.prepaidNote ?? null,
          prepaidAmount:
            payload.prepaidAmount !== undefined
              ? new Prisma.Decimal(payload.prepaidAmount)
              : null,
          items: [],
          itemsCost: new Prisma.Decimal(0),
          renewRecords: [],
          status: PrismaSpaceSessionStatus.active,
        },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              type: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      await transaction.space.update({
        where: { id: space.id },
        data: { status: PrismaSpaceStatus.occupied },
      });

      return created;
    });

    return this.toSpaceSessionResponse(session);
  }

  async addItemsToSpaceSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: AddSpaceSessionItemsDto,
  ): Promise<SpaceSessionResponseDto> {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'sales:create',
      '无权在该门店空间追加商品',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法继续点单');
    }

    const mergedItems = this.mergeSessionItems(
      this.parseSpaceSessionItems(session.items),
      this.normalizeSessionItemsPayload(dto.items),
    );

    const updated = await this.prisma.spaceSession.update({
      where: { id: session.id },
      data: {
        items: this.toSpaceSessionItemsJson(mergedItems),
        itemsCost: new Prisma.Decimal(this.sumLineTotal(mergedItems)),
      },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    return this.toSpaceSessionResponse(updated);
  }

  async renewSpaceSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: RenewSpaceSessionDto,
  ): Promise<RenewSpaceSessionResponseDto> {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'sales:create',
      '无权在该门店空间续费',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法继续续费');
    }

    if (session.billingMode !== PrismaSpaceBillingMode.countdown) {
      throw new ConflictException('仅倒计时会话支持续费');
    }

    const hourlyRate = session.hourlyRate ? Number(session.hourlyRate) : 0;
    if (hourlyRate <= 0) {
      throw new BadRequestException('当前会话缺少有效台位费，无法续费');
    }

    const payload = this.normalizeRenewPayload(dto);
    const addedMinutes = Math.floor((payload.amount / hourlyRate) * 60);
    if (addedMinutes <= 0) {
      throw new BadRequestException('续费金额不足以换算有效时长');
    }

    const renewRecord: SpaceSessionRenewRecord = {
      id: this.generateSpaceSessionRenewRecordId(),
      amount: payload.amount,
      addedMinutes,
      paymentMethod: payload.paymentMethod,
      ...(payload.grouponCode ? { grouponCode: payload.grouponCode } : {}),
      ...(payload.grouponPlatform ? { grouponPlatform: payload.grouponPlatform } : {}),
      ...(payload.note ? { note: payload.note } : {}),
      renewedAt: Date.now(),
    };
    const renewRecords = [
      ...this.parseSpaceSessionRenewRecords(session.renewRecords),
      renewRecord,
    ];

    const updated = await this.prisma.spaceSession.update({
      where: { id: session.id },
      data: {
        countdownMinutes: (session.countdownMinutes ?? 0) + addedMinutes,
        renewRecords: this.toSpaceSessionRenewRecordsJson(renewRecords),
      },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    return {
      renewRecord: { ...renewRecord },
      session: this.toSpaceSessionResponse(updated),
    };
  }

  async transferSpaceSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: TransferSpaceSessionDto,
  ): Promise<TransferSpaceSessionResponseDto> {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            storeId: true,
            enableDirtyRoom: true,
            autoCheckout: true,
            type: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'sales:create',
      '无权在该门店空间换房',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法换房');
    }

    if (dto.targetSpaceId === session.spaceId) {
      throw new ConflictException('目标空间不能与当前空间相同');
    }

    const targetSpace = await this.prisma.space.findUnique({
      where: { id: dto.targetSpaceId },
      select: {
        id: true,
        storeId: true,
        name: true,
        status: true,
        typeId: true,
        enableDirtyRoom: true,
        autoCheckout: true,
      },
    });

    if (!targetSpace) {
      throw new NotFoundException('目标空间不存在');
    }

    if (targetSpace.storeId !== session.storeId) {
      throw new ConflictException('目标空间不属于当前门店，无法换房');
    }

    if (targetSpace.status !== PrismaSpaceStatus.idle) {
      throw new ConflictException('目标空间当前不可换入');
    }

    if (targetSpace.typeId !== session.space.type.id) {
      throw new ConflictException('只能换到同类型空间');
    }

    if (targetSpace.enableDirtyRoom !== session.space.enableDirtyRoom) {
      throw new ConflictException(
        '目标空间与当前空间的脏房模式不一致，无法换房',
      );
    }

    if (targetSpace.autoCheckout !== session.space.autoCheckout) {
      throw new ConflictException(
        '目标空间与当前空间的自动结账设置不一致，无法换房',
      );
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const latestSession = await transaction.spaceSession.findUnique({
        where: { id: session.id },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              storeId: true,
              enableDirtyRoom: true,
              autoCheckout: true,
              type: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!latestSession) {
        throw new NotFoundException('空间会话不存在');
      }
      if (latestSession.status !== PrismaSpaceSessionStatus.active) {
        throw new ConflictException('当前会话已结账，无法换房');
      }

      const latestTargetSpace = await transaction.space.findUnique({
        where: { id: dto.targetSpaceId },
        select: {
          id: true,
          storeId: true,
          status: true,
          typeId: true,
          enableDirtyRoom: true,
          autoCheckout: true,
        },
      });

      if (!latestTargetSpace) {
        throw new NotFoundException('目标空间不存在');
      }
      if (latestTargetSpace.storeId !== latestSession.storeId) {
        throw new ConflictException('目标空间不属于当前门店，无法换房');
      }
      if (latestTargetSpace.status !== PrismaSpaceStatus.idle) {
        throw new ConflictException('目标空间当前不可换入');
      }
      if (latestTargetSpace.typeId !== latestSession.space.type.id) {
        throw new ConflictException('只能换到同类型空间');
      }
      if (
        latestTargetSpace.enableDirtyRoom !==
        latestSession.space.enableDirtyRoom
      ) {
        throw new ConflictException(
          '目标空间与当前空间的脏房模式不一致，无法换房',
        );
      }
      if (latestTargetSpace.autoCheckout !== latestSession.space.autoCheckout) {
        throw new ConflictException(
          '目标空间与当前空间的自动结账设置不一致，无法换房',
        );
      }

      const sourceSpaceStatus = latestSession.space.enableDirtyRoom
        ? PrismaSpaceStatus.cleaning
        : await this.resolveReservationBackStatus(
            transaction,
            latestSession.spaceId,
          );

      const updatedSession = await transaction.spaceSession.update({
        where: { id: latestSession.id },
        data: {
          spaceId: latestTargetSpace.id,
        },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              type: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      await transaction.space.update({
        where: { id: latestSession.spaceId },
        data: {
          status: sourceSpaceStatus,
        },
      });
      await transaction.space.update({
        where: { id: latestTargetSpace.id },
        data: {
          status: PrismaSpaceStatus.occupied,
        },
      });

      return {
        updatedSession,
        sourceSpaceStatus,
      };
    });

    return {
      ok: true,
      session: this.toSpaceSessionResponse(result.updatedSession),
      sourceSpaceStatus: this.toSpaceStatusValue(result.sourceSpaceStatus),
      targetSpaceStatus: this.toSpaceStatusValue(PrismaSpaceStatus.occupied),
    };
  }

  async previewSpaceSessionCheckout(
    user: AuthenticatedUser,
    sessionId: number,
    dto: CheckoutSpaceSessionPreviewDto,
  ): Promise<CheckoutSpaceSessionPreviewResponseDto> {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            enableDirtyRoom: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'sales:create',
      '无权在该门店空间创建结账预览',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法创建锁单');
    }

    const lockedAt = Date.now();
    const payload = this.normalizeCheckoutPreviewPayload(dto);
    const settlement = this.buildSpaceSessionSettlement({
      session,
      checkoutAt: lockedAt,
      payload,
      items: this.parseSpaceSessionItems(session.items),
      renewRecords: this.parseSpaceSessionRenewRecords(session.renewRecords),
    });

    const lockId = `space_lock_${randomUUID()}`;
    const expiresAt = lockedAt + SPACE_SESSION_CHECKOUT_LOCK_TTL_SECONDS * 1000;
    const lockPayload: SpaceSessionCheckoutLockPayload = {
      sessionId: session.id,
      lockedAt,
      expiresAt,
      ...(settlement.countdownFeeMode
        ? { countdownFeeMode: settlement.countdownFeeMode }
        : {}),
    };

    await this.redisService.set(
      this.buildSpaceSessionCheckoutLockKey(lockId),
      JSON.stringify(lockPayload),
      SPACE_SESSION_CHECKOUT_LOCK_TTL_SECONDS,
    );

    return {
      lockId,
      lockedAt,
      expiresAt,
      preview: {
        durationMinutes: settlement.durationMinutes,
        durationLabel: settlement.durationLabel,
        timeCost: settlement.timeCost,
        itemsCost: settlement.itemsCost,
        renewDeduction: settlement.renewDeduction,
        prepaidDeduction: settlement.prepaidDeduction,
        totalAmount: settlement.totalAmount,
      },
    };
  }

  async checkoutSpaceSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: CheckoutSpaceSessionDto,
  ): Promise<CheckoutSpaceSessionResponseDto> {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            enableDirtyRoom: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'sales:create',
      '无权在该门店空间结账',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法重复操作');
    }

    const payload = this.normalizeCheckoutPayload(dto);
    const lockPayload = payload.lockId
      ? await this.requireValidSpaceSessionCheckoutLock(
          session.id,
          payload.lockId,
          payload.countdownFeeMode,
        )
      : null;
    const checkoutAt = lockPayload?.lockedAt ?? payload.lockedAt ?? Date.now();
    if (checkoutAt < session.startTime.getTime()) {
      throw new BadRequestException('锁单时间不能早于开台时间');
    }

    const countdownFeeMode =
      lockPayload?.countdownFeeMode ?? payload.countdownFeeMode;
    const items = this.parseSpaceSessionItems(session.items);
    const renewRecords = this.parseSpaceSessionRenewRecords(
      session.renewRecords,
    );
    const settlement = this.buildSpaceSessionSettlement({
      session,
      checkoutAt,
      payload: { countdownFeeMode },
      items,
      renewRecords,
    });

    const createdOrder = await this.createSessionSaleOrder(user, {
      storeId: session.storeId,
      checkoutAt,
      paymentMethod: payload.paymentMethod,
      note: payload.note,
      items: settlement.orderItems,
      totalRevenue: settlement.totalRevenue,
      totalProfit: settlement.totalProfit,
      totalQuantity: settlement.totalQuantity,
    });

    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextSession = await transaction.spaceSession.update({
        where: { id: session.id },
        data: {
          endTime: new Date(checkoutAt),
          timeCost: new Prisma.Decimal(settlement.timeCost),
          items: this.toSpaceSessionItemsJson(settlement.orderItems),
          itemsCost: new Prisma.Decimal(settlement.itemsCost),
          renewRecords: this.toSpaceSessionRenewRecordsJson(renewRecords),
          status: PrismaSpaceSessionStatus.settled,
          saleOrderId: Number(createdOrder.id),
        },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              type: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      const cancelledReservationId = await this.cancelMatchedReservationAfterCheckout(
        transaction,
        session,
      );
      const nextSpaceStatus = session.space.enableDirtyRoom
        ? PrismaSpaceStatus.cleaning
        : await this.resolveReservationBackStatus(
            transaction,
            session.spaceId,
          );

      await transaction.space.update({
        where: { id: session.spaceId },
        data: {
          status: nextSpaceStatus,
        },
      });

      return {
        session: nextSession,
        spaceStatus: nextSpaceStatus,
        cancelledReservationId,
      };
    });

    if (payload.lockId) {
      await this.redisService.del(
        this.buildSpaceSessionCheckoutLockKey(payload.lockId),
      );
    }

    return {
      session: this.toSpaceSessionResponse(updated.session),
      spaceStatus: this.toSpaceStatusValue(updated.spaceStatus),
      ...(updated.cancelledReservationId !== null
        ? { cancelledReservationId: String(updated.cancelledReservationId) }
        : {}),
      salesOrder: createdOrder,
    };
  }

  async listSpaceReservations(
    user: AuthenticatedUser,
    spaceId: number,
    query: ListSpaceReservationsQueryDto,
  ): Promise<SpaceReservationResponseDto[]> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:view',
      '无权查看该门店空间预约',
    );

    const status = query.status ?? 'pending';
    const items = await this.prisma.spaceReservation.findMany({
      where: {
        spaceId: space.id,
        status,
        ...(query.dateFrom !== undefined || query.dateTo !== undefined
          ? {
              reservedAt: {
                ...(query.dateFrom !== undefined
                  ? { gte: new Date(query.dateFrom) }
                  : {}),
                ...(query.dateTo !== undefined
                  ? { lte: new Date(query.dateTo) }
                  : {}),
              },
            }
          : {}),
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceReservationResponse(item));
  }

  async listStoreSpaceReservations(
    user: AuthenticatedUser,
    query: ListSpaceReservationsQueryDto,
  ): Promise<SpaceReservationResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间预约',
    );

    if (storeId === null) {
      return [];
    }

    if (
      query.dateFrom !== undefined &&
      query.dateTo !== undefined &&
      query.dateFrom > query.dateTo
    ) {
      throw new BadRequestException('区间开始时间不能晚于结束时间');
    }

    const items = await this.prisma.spaceReservation.findMany({
      where: {
        storeId,
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.dateFrom !== undefined || query.dateTo !== undefined
          ? {
              reservedAt: {
                ...(query.dateFrom !== undefined
                  ? { gte: new Date(query.dateFrom) }
                  : {}),
                ...(query.dateTo !== undefined
                  ? { lte: new Date(query.dateTo) }
                  : {}),
              },
            }
          : {}),
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceReservationResponse(item));
  }

  async createSpaceReservation(
    user: AuthenticatedUser,
    spaceId: number,
    dto: CreateSpaceReservationDto,
  ): Promise<SpaceReservationResponseDto> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:create',
      '无权操作该门店空间预约',
    );

    const payload = this.normalizeReservationPayload(dto);
    this.ensureReservationTimeWindow(payload.reservedAt);
    this.ensureReservationEndAfterStart(
      payload.reservedAt,
      payload.reservedEndAt,
    );

    const conflict = await this.findReservationConflict(
      space.id,
      payload.reservedAt,
      payload.reservedEndAt,
    );

    if (conflict) {
      throw new ConflictException(`与「${conflict.guestName}」的预约时间冲突`);
    }

    const reservation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.spaceReservation.create({
        data: {
          storeId: space.storeId,
          spaceId: space.id,
          guestName: payload.guestName,
          phone: payload.phone,
          reservedAt: new Date(payload.reservedAt),
          reservedEndAt: new Date(payload.reservedEndAt),
          guestCount: payload.guestCount,
          note: payload.note,
          status: PrismaSpaceReservationStatus.pending,
        },
      });

      await this.syncNonOccupiedSpaceStatus(transaction, space.id);
      return created;
    });

    return this.toSpaceReservationResponse(reservation);
  }

  async updateSpaceReservation(
    user: AuthenticatedUser,
    reservationId: number,
    dto: UpdateSpaceReservationDto,
  ): Promise<SpaceReservationResponseDto> {
    const reservation = await this.prisma.spaceReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        storeId: true,
        spaceId: true,
        status: true,
      },
    });

    if (!reservation) {
      throw new NotFoundException('预约不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      reservation.storeId,
      'space:update',
      '无权操作该门店空间预约',
    );

    if (reservation.status !== PrismaSpaceReservationStatus.pending) {
      throw new ConflictException('当前预约已处理，无法修改');
    }

    const payload = this.normalizeReservationPayload(dto);
    // 编辑预约不限制时间窗口：预约开始时间已过后店员仍可能需要补录或调整，
    // 前端对过时预约会标记为"已过时"展示态，不再参与新预约冲突校验。
    this.ensureReservationEndAfterStart(
      payload.reservedAt,
      payload.reservedEndAt,
    );

    const conflict = await this.findReservationConflict(
      reservation.spaceId,
      payload.reservedAt,
      payload.reservedEndAt,
      reservation.id,
    );

    if (conflict) {
      throw new ConflictException(`与「${conflict.guestName}」的预约时间冲突`);
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextReservation = await transaction.spaceReservation.update({
        where: { id: reservation.id },
        data: {
          guestName: payload.guestName,
          phone: payload.phone,
          reservedAt: new Date(payload.reservedAt),
          reservedEndAt: new Date(payload.reservedEndAt),
          guestCount: payload.guestCount,
          note: payload.note,
        },
      });

      await this.syncNonOccupiedSpaceStatus(transaction, reservation.spaceId);
      return nextReservation;
    });

    return this.toSpaceReservationResponse(updated);
  }

  async cancelSpaceReservation(
    user: AuthenticatedUser,
    reservationId: number,
  ): Promise<SpaceReservationResponseDto> {
    const reservation = await this.prisma.spaceReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        storeId: true,
        spaceId: true,
        status: true,
      },
    });

    if (!reservation) {
      throw new NotFoundException('预约不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      reservation.storeId,
      'space:update',
      '无权操作该门店空间预约',
    );

    if (reservation.status !== PrismaSpaceReservationStatus.pending) {
      throw new ConflictException('当前预约已处理，无法取消');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextReservation = await transaction.spaceReservation.update({
        where: { id: reservation.id },
        data: {
          status: PrismaSpaceReservationStatus.cancelled,
        },
      });

      await this.syncNonOccupiedSpaceStatus(transaction, reservation.spaceId);
      return nextReservation;
    });

    return this.toSpaceReservationResponse(updated);
  }

  async removeSpace(user: AuthenticatedUser, spaceId: number): Promise<void> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        storeId: true,
        status: true,
        sortOrder: true,
        _count: {
          select: {
            reservations: {
              where: {
                status: PrismaSpaceReservationStatus.pending,
              },
            },
          },
        },
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:delete',
      '无权删除该门店空间',
    );

    if (space.status === PrismaSpaceStatus.occupied) {
      throw new ConflictException('空间使用中，无法删除');
    }

    if (space._count.reservations > 0) {
      throw new ConflictException('该空间存在待处理预约，请先取消预约后再删除');
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.space.delete({
        where: { id: space.id },
      });

      await transaction.space.updateMany({
        where: {
          storeId: space.storeId,
          sortOrder: {
            gt: space.sortOrder,
          },
        },
        data: {
          sortOrder: {
            decrement: 1,
          },
        },
      });
    });
  }

  private normalizeOpenSessionPayload(dto: OpenSpaceSessionDto): {
    guestName?: string;
    guestPhone?: string;
    guestCount?: number;
    billingMode: SpaceBillingModeValue;
    hourlyRate?: number;
    countdownMinutes?: number;
    autoCheckout?: boolean;
    reservationId?: number;
    prepaidPaymentMethod?: SalesPaymentMethodValue;
    prepaidGrouponCode?: string;
    prepaidNote?: string;
    prepaidAmount?: number;
  } {
    const guestName = dto.guestName?.trim();
    const guestPhone = dto.guestPhone?.trim();
    const prepaidGrouponCode = dto.prepaidGrouponCode?.trim();
    const prepaidNote = dto.prepaidNote?.trim();

    return {
      ...(guestName ? { guestName } : {}),
      ...(guestPhone ? { guestPhone } : {}),
      ...(dto.guestCount !== undefined ? { guestCount: dto.guestCount } : {}),
      billingMode: dto.billingMode,
      ...(dto.hourlyRate !== undefined ? { hourlyRate: dto.hourlyRate } : {}),
      ...(dto.countdownMinutes !== undefined
        ? { countdownMinutes: dto.countdownMinutes }
        : {}),
      ...(dto.autoCheckout !== undefined
        ? { autoCheckout: dto.autoCheckout }
        : {}),
      ...(dto.reservationId !== undefined
        ? { reservationId: dto.reservationId }
        : {}),
      ...(dto.prepaidPaymentMethod !== undefined
        ? { prepaidPaymentMethod: dto.prepaidPaymentMethod }
        : {}),
      ...(prepaidGrouponCode ? { prepaidGrouponCode } : {}),
      ...(prepaidNote ? { prepaidNote } : {}),
      ...(dto.prepaidAmount !== undefined
        ? { prepaidAmount: dto.prepaidAmount }
        : {}),
    };
  }

  private ensureOpenSessionPayload(
    payload: ReturnType<SpacesService['normalizeOpenSessionPayload']>,
  ): void {
    if (
      payload.billingMode !== 'items' &&
      payload.billingMode !== 'countdown' &&
      (payload.hourlyRate === undefined || payload.hourlyRate <= 0)
    ) {
      throw new BadRequestException('请输入有效的计时单价');
    }

    if (payload.billingMode === 'countdown') {
      if (
        payload.countdownMinutes === undefined ||
        payload.countdownMinutes <= 0
      ) {
        throw new BadRequestException('请输入有效的倒计时时长');
      }
      if (payload.hourlyRate === undefined || payload.hourlyRate <= 0) {
        throw new BadRequestException('请输入台位费');
      }
      if (payload.autoCheckout) {
        if (
          payload.prepaidPaymentMethod === undefined ||
          payload.prepaidAmount === undefined ||
          payload.prepaidAmount <= 0
        ) {
          throw new BadRequestException(
            '自动结账模式下请输入付款金额与支付方式',
          );
        }
      }
    }
  }

  private normalizeCheckoutPreviewPayload(
    dto: CheckoutSpaceSessionPreviewDto,
  ): {
    countdownFeeMode?: SpaceCountdownFeeModeValue;
  } {
    return dto.countdownFeeMode !== undefined
      ? { countdownFeeMode: dto.countdownFeeMode }
      : {};
  }

  private normalizeCheckoutPayload(dto: CheckoutSpaceSessionDto): {
    paymentMethod: SalesPaymentMethodValue;
    note?: string;
    grouponCode?: string;
    grouponPlatform?: string;
    countdownFeeMode?: SpaceCountdownFeeModeValue;
    lockId?: string;
    lockedAt?: number;
  } {
    const note = dto.note?.trim();
    const grouponCode = dto.grouponCode?.trim();
    const grouponPlatform = dto.grouponPlatform?.trim();
    const lockId = dto.lockId?.trim();

    return {
      paymentMethod: dto.paymentMethod,
      ...(note ? { note } : {}),
      ...(grouponCode ? { grouponCode } : {}),
      ...(grouponPlatform ? { grouponPlatform } : {}),
      ...(dto.countdownFeeMode !== undefined
        ? { countdownFeeMode: dto.countdownFeeMode }
        : {}),
      ...(lockId ? { lockId } : {}),
      ...(dto.lockedAt !== undefined ? { lockedAt: dto.lockedAt } : {}),
    };
  }

  private buildSpaceSessionCheckoutLockKey(lockId: string): string {
    return `space:checkout-lock:${lockId}`;
  }

  private async requireValidSpaceSessionCheckoutLock(
    sessionId: number,
    lockId: string,
    countdownFeeMode?: SpaceCountdownFeeModeValue,
  ): Promise<SpaceSessionCheckoutLockPayload> {
    const raw = await this.redisService.get(
      this.buildSpaceSessionCheckoutLockKey(lockId),
    );

    if (!raw) {
      throw new BadRequestException('锁单已失效，请重新预览后再结账');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('锁单数据异常，请重新预览后再结账');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('锁单数据异常，请重新预览后再结账');
    }

    const payload = parsed as Record<string, unknown>;
    if (
      typeof payload.sessionId !== 'number' ||
      typeof payload.lockedAt !== 'number' ||
      typeof payload.expiresAt !== 'number'
    ) {
      throw new BadRequestException('锁单数据异常，请重新预览后再结账');
    }

    if (payload.sessionId !== sessionId) {
      throw new BadRequestException('锁单与当前会话不匹配');
    }

    const lockedCountdownFeeMode =
      payload.countdownFeeMode === 'timed' ||
      payload.countdownFeeMode === 'fixed'
        ? payload.countdownFeeMode
        : undefined;
    if (
      countdownFeeMode !== undefined &&
      lockedCountdownFeeMode !== undefined &&
      lockedCountdownFeeMode !== countdownFeeMode
    ) {
      throw new BadRequestException('结账口径已变化，请重新预览后再结账');
    }

    return {
      sessionId: payload.sessionId,
      lockedAt: payload.lockedAt,
      expiresAt: payload.expiresAt,
      ...(lockedCountdownFeeMode
        ? { countdownFeeMode: lockedCountdownFeeMode }
        : {}),
    };
  }

  private normalizeSessionItemsPayload(
    items: Array<{
      productId: string;
      productName: string;
      categoryName: string;
      salePrice: number;
      profit: number;
      quantity: number;
    }>,
  ): SpaceSessionItemRecord[] {
    if (items.length === 0) {
      throw new BadRequestException('请至少选择一件商品');
    }

    return items.map((item) => {
      const productId = item.productId.trim();
      const productName = item.productName.trim();
      const categoryName = item.categoryName.trim();

      if (!productId) {
        throw new BadRequestException('商品 ID 不能为空');
      }
      if (!productName) {
        throw new BadRequestException('商品名称不能为空');
      }
      if (!categoryName) {
        throw new BadRequestException('商品分类不能为空');
      }

      return {
        productId,
        productName,
        categoryName,
        salePrice: item.salePrice,
        profit: item.profit,
        quantity: item.quantity,
      };
    });
  }

  private mergeSessionItems(
    currentItems: SpaceSessionItemRecord[],
    appendedItems: SpaceSessionItemRecord[],
  ): SpaceSessionItemRecord[] {
    const mergedItems = currentItems.map((item) => ({ ...item }));

    for (const item of appendedItems) {
      const existing = mergedItems.find(
        (currentItem) => currentItem.productId === item.productId,
      );
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        mergedItems.push({ ...item });
      }
    }

    return mergedItems;
  }

  private normalizeRenewPayload(dto: RenewSpaceSessionDto): {
    amount: number;
    paymentMethod: SalesPaymentMethodValue;
    grouponCode?: string;
    grouponPlatform?: string;
    note?: string;
  } {
    const grouponCode = dto.grouponCode?.trim();
    const grouponPlatform = dto.grouponPlatform?.trim();
    const note = dto.note?.trim();

    return {
      amount: dto.amount,
      paymentMethod: dto.paymentMethod,
      ...(grouponCode ? { grouponCode } : {}),
      ...(grouponPlatform ? { grouponPlatform } : {}),
      ...(note ? { note } : {}),
    };
  }

  private generateSpaceSessionRenewRecordId(): string {
    return `rn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  private async ensureReservationCanBeFulfilled(
    storeId: number,
    spaceId: number,
    reservationId: number,
  ): Promise<void> {
    const reservation = await this.prisma.spaceReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        storeId: true,
        spaceId: true,
        status: true,
      },
    });

    if (!reservation) {
      throw new NotFoundException('预约不存在');
    }
    if (reservation.storeId !== storeId || reservation.spaceId !== spaceId) {
      throw new ConflictException('该预约不属于当前空间，无法履约开台');
    }
    if (reservation.status !== PrismaSpaceReservationStatus.pending) {
      throw new ConflictException('当前预约已处理，无法再次履约开台');
    }
  }

  private buildSpaceSessionSettlement(params: {
    session: SpaceSessionRecord & {
      space: {
        id: number;
        name: string;
        enableDirtyRoom: boolean;
        type: { name: string };
      };
    };
    checkoutAt: number;
    payload: ReturnType<SpacesService['normalizeCheckoutPreviewPayload']>;
    items: SpaceSessionItemRecord[];
    renewRecords: SpaceSessionRenewRecord[];
  }): {
    durationMinutes: number;
    durationLabel: string;
    countdownFeeMode?: SpaceCountdownFeeModeValue;
    timeCost: number;
    itemsCost: number;
    renewDeduction: number;
    prepaidDeduction: number;
    totalAmount: number;
    orderItems: SpaceSessionItemRecord[];
    totalRevenue: number;
    totalProfit: number;
    totalQuantity: number;
  } {
    const { session, checkoutAt, payload, items, renewRecords } = params;
    const orderItems = items.map((item) => ({ ...item }));
    const itemsCost = this.sumLineTotal(items);
    const durationMinutes = this.calcDurationMinutes(
      session.startTime.getTime(),
      checkoutAt,
    );
    const durationLabel = this.formatDurationLabel(durationMinutes);
    const countdownFeeMode = this.resolveSpaceSessionCountdownFeeMode(
      session,
      renewRecords,
      payload.countdownFeeMode,
    );
    let timeCost = 0;

    if (
      session.billingMode !== PrismaSpaceBillingMode.items &&
      session.hourlyRate !== null
    ) {
      const hourlyRate = Number(session.hourlyRate);
      if (session.billingMode === PrismaSpaceBillingMode.countdown) {
        const useFixed = countdownFeeMode === 'fixed';
        timeCost = useFixed
          ? hourlyRate
          : this.calcTimeCost(
              session.startTime.getTime(),
              checkoutAt,
              hourlyRate,
            );
        orderItems.unshift({
          productId: 'SYS_TIME_BILLING',
          productName: useFixed
            ? '台位费（固定）'
            : `台位费（${durationLabel}）`,
          categoryName: '场地费',
          salePrice: timeCost,
          profit: timeCost,
          quantity: 1,
        });
      } else {
        timeCost = this.calcTimeCost(
          session.startTime.getTime(),
          checkoutAt,
          hourlyRate,
        );
        orderItems.unshift({
          productId: 'SYS_TIME_BILLING',
          productName: `台位费（${durationLabel}）`,
          categoryName: '场地费',
          salePrice: timeCost,
          profit: timeCost,
          quantity: 1,
        });
      }
    }

    const renewDeduction = Number(
      renewRecords.reduce((sum, record) => sum + record.amount, 0).toFixed(2),
    );
    if (renewDeduction > 0) {
      orderItems.push({
        productId: 'SYS_RENEW_DEDUCTION',
        productName: '续费抵扣',
        categoryName: '场地费',
        salePrice: -renewDeduction,
        profit: -renewDeduction,
        quantity: 1,
      });
    }

    const prepaidDeduction = this.resolveSpaceSessionPrepaidDeduction(
      session,
      countdownFeeMode,
    );
    if (prepaidDeduction > 0) {
      orderItems.push({
        productId: 'SYS_PREPAID_DEDUCTION',
        productName: '预付抵扣',
        categoryName: '场地费',
        salePrice: -prepaidDeduction,
        profit: -prepaidDeduction,
        quantity: 1,
      });
    }

    if (orderItems.length === 0) {
      orderItems.push({
        productId: 'SYS_EMPTY_SETTLEMENT',
        productName: '场地结账',
        categoryName: '场地费',
        salePrice: 0,
        profit: 0,
        quantity: 1,
      });
    }

    const totalRevenue = this.sumLineTotal(orderItems);
    const totalProfit = this.sumLineProfit(orderItems);
    const totalQuantity = orderItems.reduce(
      (sum, item) =>
        sum +
        (this.isSpaceSessionDeductionItem(item.productId) ? 0 : item.quantity),
      0,
    );

    return {
      durationMinutes,
      durationLabel,
      ...(countdownFeeMode ? { countdownFeeMode } : {}),
      timeCost,
      itemsCost,
      renewDeduction,
      prepaidDeduction,
      totalAmount: totalRevenue,
      orderItems,
      totalRevenue,
      totalProfit,
      totalQuantity,
    };
  }

  private async createSessionSaleOrder(
    user: AuthenticatedUser,
    params: {
      storeId: number;
      checkoutAt: number;
      paymentMethod: SalesPaymentMethodValue;
      note?: string;
      items: SpaceSessionItemRecord[];
      totalRevenue: number;
      totalProfit: number;
      totalQuantity: number;
    },
  ): Promise<SalesRecordResponseDto> {
    const dto: CreateSalesRecordDto = {
      storeId: params.storeId,
      items: params.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        salePrice: item.salePrice,
        profit: item.profit,
        quantity: item.quantity,
      })),
      totalRevenue: params.totalRevenue,
      totalProfit: params.totalProfit,
      totalQuantity: params.totalQuantity,
      paymentMethod: params.paymentMethod,
      calcMode: 'business',
      ...(params.note ? { note: params.note } : {}),
      date: params.checkoutAt,
    };

    return this.salesRecordService.create(user, dto);
  }

  private async cancelMatchedReservationAfterCheckout(
    transaction: Prisma.TransactionClient,
    session: SpaceSessionRecord & {
      space: {
        id: number;
        name: string;
        enableDirtyRoom: boolean;
        type: { name: string };
      };
    },
  ): Promise<number | null> {
    if (session.reservationId !== null) {
      return null;
    }

    const guestName = session.guestName?.trim();
    const guestPhone = session.guestPhone?.trim();
    if (!guestName || !guestPhone) {
      return null;
    }

    const todayRange = this.getTodayRange();
    const candidates = await transaction.spaceReservation.findMany({
      where: {
        spaceId: session.spaceId,
        status: PrismaSpaceReservationStatus.pending,
        guestName,
        phone: guestPhone,
        reservedAt: {
          gte: todayRange.start,
          lte: todayRange.end,
        },
      },
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
    });

    const nearest = candidates.sort(
      (a, b) =>
        Math.abs(a.reservedAt.getTime() - session.startTime.getTime()) -
        Math.abs(b.reservedAt.getTime() - session.startTime.getTime()),
    )[0];

    if (!nearest) {
      return null;
    }

    await transaction.spaceReservation.update({
      where: { id: nearest.id },
      data: {
        status: PrismaSpaceReservationStatus.cancelled,
      },
    });

    return nearest.id;
  }

  private toSpaceSessionItemsJson(
    items: SpaceSessionItemRecord[],
  ): Prisma.InputJsonValue {
    return items.map((item) => ({ ...item })) as Prisma.InputJsonValue;
  }

  private toSpaceSessionRenewRecordsJson(
    records: SpaceSessionRenewRecord[],
  ): Prisma.InputJsonValue {
    return records.map((record) => ({ ...record })) as Prisma.InputJsonValue;
  }

  private parseSpaceSessionItems(
    value: Prisma.JsonValue,
  ): SpaceSessionItemRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return [];
      }
      const row = item as Record<string, unknown>;
      if (
        typeof row.productId !== 'string' ||
        typeof row.productName !== 'string' ||
        typeof row.categoryName !== 'string' ||
        typeof row.salePrice !== 'number' ||
        typeof row.profit !== 'number' ||
        typeof row.quantity !== 'number'
      ) {
        return [];
      }

      return [
        {
          productId: row.productId,
          productName: row.productName,
          categoryName: row.categoryName,
          salePrice: row.salePrice,
          profit: row.profit,
          quantity: row.quantity,
        },
      ];
    });
  }

  private parseSpaceSessionRenewRecords(
    value: Prisma.JsonValue,
  ): SpaceSessionRenewRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return [];
      }
      const row = item as Record<string, unknown>;
      if (
        typeof row.id !== 'string' ||
        typeof row.amount !== 'number' ||
        typeof row.addedMinutes !== 'number' ||
        typeof row.paymentMethod !== 'string' ||
        typeof row.renewedAt !== 'number'
      ) {
        return [];
      }

      return [
        {
          id: row.id,
          amount: row.amount,
          addedMinutes: row.addedMinutes,
          paymentMethod: row.paymentMethod as SalesPaymentMethodValue,
          ...(typeof row.grouponCode === 'string'
            ? { grouponCode: row.grouponCode }
            : {}),
          ...(typeof row.grouponPlatform === 'string'
            ? { grouponPlatform: row.grouponPlatform }
            : {}),
          ...(typeof row.note === 'string' ? { note: row.note } : {}),
          renewedAt: row.renewedAt,
        },
      ];
    });
  }

  private resolveSpaceSessionCountdownFeeMode(
    session: Pick<SpaceSessionRecord, 'billingMode'>,
    renewRecords: SpaceSessionRenewRecord[],
    countdownFeeMode?: SpaceCountdownFeeModeValue,
  ): SpaceCountdownFeeModeValue | undefined {
    if (session.billingMode !== PrismaSpaceBillingMode.countdown) {
      return undefined;
    }

    if (countdownFeeMode !== undefined) {
      return countdownFeeMode;
    }

    return renewRecords.length > 0 ? 'timed' : 'fixed';
  }

  private resolveSpaceSessionPrepaidDeduction(
    session: Pick<
      SpaceSessionRecord,
      'autoCheckout' | 'billingMode' | 'prepaidAmount'
    >,
    countdownFeeMode?: SpaceCountdownFeeModeValue,
  ): number {
    if (
      !session.autoCheckout ||
      session.billingMode !== PrismaSpaceBillingMode.countdown ||
      countdownFeeMode !== 'timed' ||
      session.prepaidAmount === null
    ) {
      return 0;
    }

    const prepaidAmount = Number(session.prepaidAmount);
    return prepaidAmount > 0 ? prepaidAmount : 0;
  }

  private isSpaceSessionDeductionItem(productId: string): boolean {
    return (
      productId === 'SYS_RENEW_DEDUCTION' ||
      productId === 'SYS_PREPAID_DEDUCTION'
    );
  }

  private calcDurationMinutes(startTime: number, endTime: number): number {
    const rawMinutes = (endTime - startTime) / (1000 * 60);
    return Math.max(1, Math.ceil(rawMinutes));
  }

  private formatDurationLabel(durationMinutes: number): string {
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    return hours > 0
      ? `${hours}小时${minutes > 0 ? `${minutes}分钟` : ''}`
      : `${minutes}分钟`;
  }

  private calcTimeCost(
    startTime: number,
    endTime: number,
    hourlyRate: number,
  ): number {
    const minutes = this.calcDurationMinutes(startTime, endTime);
    return Math.ceil((minutes / 60) * hourlyRate * 100) / 100;
  }

  private sumLineTotal(items: SpaceSessionItemRecord[]): number {
    return Number(
      items
        .reduce((sum, item) => sum + item.salePrice * item.quantity, 0)
        .toFixed(2),
    );
  }

  private sumLineProfit(items: SpaceSessionItemRecord[]): number {
    return Number(
      items
        .reduce((sum, item) => sum + item.profit * item.quantity, 0)
        .toFixed(2),
    );
  }

  private toSpaceSessionListQuery(
    query: ListSpaceSessionsQueryDto,
  ): SpaceSessionListQuery {
    return {
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      includeActive: query.includeActive,
      keyword: query.keyword,
      rangeStartDate: query.rangeStartDate,
      rangeEndDate: query.rangeEndDate,
    };
  }

  private resolvePageQuery(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;

    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }

  private buildSpaceSessionListWhere(
    spaceId: number,
    query: SpaceSessionListQuery,
  ): Prisma.SpaceSessionWhereInput {
    const conditions: Prisma.SpaceSessionWhereInput[] = [{ spaceId }];

    if (query.status) {
      conditions.push({ status: query.status });
    } else if (query.includeActive !== true) {
      conditions.push({ status: PrismaSpaceSessionStatus.settled });
    }

    if (query.keyword) {
      conditions.push({
        OR: [
          { guestName: { contains: query.keyword, mode: 'insensitive' } },
          { guestPhone: { contains: query.keyword } },
        ],
      });
    }

    const timeRangeCondition = this.buildSpaceSessionTimeRangeWhere(
      query.rangeStartDate,
      query.rangeEndDate,
    );
    if (timeRangeCondition) {
      conditions.push(timeRangeCondition);
    }

    return conditions.length === 1 ? conditions[0] : { AND: conditions };
  }

  private buildStoreSpaceSessionListWhere(
    storeId: number,
    query: SpaceSessionListQuery,
  ): Prisma.SpaceSessionWhereInput {
    const conditions: Prisma.SpaceSessionWhereInput[] = [{ storeId }];

    if (query.status) {
      conditions.push({ status: query.status });
    } else if (query.includeActive !== true) {
      conditions.push({ status: PrismaSpaceSessionStatus.settled });
    }

    if (query.keyword) {
      conditions.push({
        OR: [
          { guestName: { contains: query.keyword, mode: 'insensitive' } },
          { guestPhone: { contains: query.keyword } },
          { space: { name: { contains: query.keyword, mode: 'insensitive' } } },
        ],
      });
    }

    const timeRangeCondition = this.buildSpaceSessionTimeRangeWhere(
      query.rangeStartDate,
      query.rangeEndDate,
    );
    if (timeRangeCondition) {
      conditions.push(timeRangeCondition);
    }

    return conditions.length === 1 ? conditions[0] : { AND: conditions };
  }

  private buildSpaceSessionTimeRangeWhere(
    rangeStartDate?: number,
    rangeEndDate?: number,
  ): Prisma.SpaceSessionWhereInput | undefined {
    if (rangeStartDate === undefined && rangeEndDate === undefined) {
      return undefined;
    }

    if (
      rangeStartDate !== undefined &&
      rangeEndDate !== undefined &&
      rangeStartDate > rangeEndDate
    ) {
      throw new BadRequestException('区间开始时间不能晚于结束时间');
    }

    const conditions: Prisma.SpaceSessionWhereInput[] = [];

    if (rangeEndDate !== undefined) {
      conditions.push({
        startTime: {
          lte: new Date(rangeEndDate),
        },
      });
    }

    if (rangeStartDate !== undefined) {
      conditions.push({
        OR: [
          {
            endTime: {
              gte: new Date(rangeStartDate),
            },
          },
          {
            endTime: null,
          },
        ],
      });
    }

    return conditions.length === 1 ? conditions[0] : { AND: conditions };
  }

  private toPrismaSpaceBillingMode(
    value: SpaceBillingModeValue,
  ): PrismaSpaceBillingMode {
    return value;
  }

  private toSpaceSessionResponse(
    session: SpaceSessionRecord,
  ): SpaceSessionResponseDto {
    const items = this.parseSpaceSessionItems(session.items);
    const renewRecords = this.parseSpaceSessionRenewRecords(
      session.renewRecords,
    );

    return {
      id: String(session.id),
      spaceId: String(session.spaceId),
      spaceName: session.space.name,
      spaceType: session.space.type.name,
      ...(session.guestName ? { guestName: session.guestName } : {}),
      ...(session.guestPhone ? { guestPhone: session.guestPhone } : {}),
      ...(session.guestCount !== null
        ? { guestCount: session.guestCount }
        : {}),
      startTime: toTimestampMs(session.startTime),
      ...(session.endTime ? { endTime: toTimestampMs(session.endTime) } : {}),
      billingMode: session.billingMode,
      ...(session.hourlyRate !== null
        ? { hourlyRate: Number(session.hourlyRate) }
        : {}),
      ...(session.timeCost !== null
        ? { timeCost: Number(session.timeCost) }
        : {}),
      ...(session.countdownMinutes !== null
        ? { countdownMinutes: session.countdownMinutes }
        : {}),
      ...(session.autoCheckout !== null
        ? { autoCheckout: session.autoCheckout }
        : {}),
      ...(session.prepaidPaymentMethod
        ? { prepaidPaymentMethod: session.prepaidPaymentMethod }
        : {}),
      ...(session.prepaidGrouponCode
        ? { prepaidGrouponCode: session.prepaidGrouponCode }
        : {}),
      ...(session.prepaidNote ? { prepaidNote: session.prepaidNote } : {}),
      ...(session.prepaidAmount !== null
        ? { prepaidAmount: Number(session.prepaidAmount) }
        : {}),
      items: items.map((item): SpaceSessionItemResponseDto => ({ ...item })),
      itemsCost: Number(session.itemsCost),
      renewRecords: renewRecords.map(
        (record): SpaceSessionRenewRecordResponseDto => ({ ...record }),
      ),
      status: this.toSpaceSessionStatusValue(session.status),
      ...(session.saleOrderId !== null
        ? { orderId: String(session.saleOrderId) }
        : {}),
      createdAt: toTimestampMs(session.createdAt),
    };
  }

  private toSpaceSessionStatusValue(
    status: PrismaSpaceSessionStatus,
  ): SpaceSessionStatusValue {
    return status;
  }

  private async findReservationConflict(
    spaceId: number,
    reservedAt: number,
    reservedEndAt: number,
    excludeReservationId?: number,
  ): Promise<SpaceReservationRecord | null> {
    const reservations = await this.prisma.spaceReservation.findMany({
      where: {
        spaceId,
        status: PrismaSpaceReservationStatus.pending,
        ...(excludeReservationId !== undefined
          ? {
              id: {
                not: excludeReservationId,
              },
            }
          : {}),
      },
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
    });

    const conflict = reservations.find((reservation) => {
      if (this.isReservationExpiredForConflict(reservation.reservedAt)) {
        return false;
      }

      const candidateEndAt = reservation.reservedEndAt
        ? reservation.reservedEndAt.getTime()
        : reservation.reservedAt.getTime() + 60 * 60 * 1000;

      return (
        reservedAt < candidateEndAt &&
        reservation.reservedAt.getTime() < reservedEndAt
      );
    });

    return conflict ?? null;
  }

  private async resolveReservationBackStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<PrismaSpaceStatus> {
    const todayRange = this.getTodayRange();
    const hasTodayPendingReservation =
      await transaction.spaceReservation.findFirst({
        where: {
          spaceId,
          status: PrismaSpaceReservationStatus.pending,
          reservedAt: {
            gte: todayRange.start,
            lte: todayRange.end,
          },
        },
        select: {
          id: true,
        },
      });

    return hasTodayPendingReservation
      ? PrismaSpaceStatus.reserved
      : PrismaSpaceStatus.idle;
  }

  private async syncNonOccupiedSpaceStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<void> {
    const current = await transaction.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!current) {
      throw new NotFoundException('空间不存在');
    }

    if (
      current.status === PrismaSpaceStatus.occupied ||
      current.status === PrismaSpaceStatus.cleaning
    ) {
      return;
    }

    const nextStatus = await this.resolveReservationBackStatus(
      transaction,
      spaceId,
    );

    if (nextStatus !== current.status) {
      await transaction.space.update({
        where: { id: spaceId },
        data: { status: nextStatus },
      });
    }
  }

  private normalizeReservationPayload(
    dto: CreateSpaceReservationDto | UpdateSpaceReservationDto,
  ): {
    guestName: string;
    phone: string;
    reservedAt: number;
    reservedEndAt: number;
    guestCount?: number;
    note?: string;
  } {
    const guestName = dto.guestName.trim();
    const phone = dto.phone.trim();
    if (!guestName) {
      throw new BadRequestException('预约人姓名不能为空');
    }
    if (!phone) {
      throw new BadRequestException('联系方式不能为空');
    }

    const reservedAt = dto.reservedAt;
    const reservedEndAt = dto.reservedEndAt ?? reservedAt + 60 * 60 * 1000;
    const note = dto.note?.trim();

    return {
      guestName,
      phone,
      reservedAt,
      reservedEndAt,
      ...(dto.guestCount !== undefined ? { guestCount: dto.guestCount } : {}),
      ...(note ? { note } : {}),
    };
  }

  private ensureReservationTimeWindow(reservedAt: number): void {
    const now = Date.now();
    if (reservedAt < now) {
      throw new BadRequestException('预约时间不能早于当前时间');
    }

    const current = new Date();
    const maxTimestamp = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 2,
      23,
      59,
      0,
      0,
    ).getTime();

    if (reservedAt > maxTimestamp) {
      throw new BadRequestException('最多只能预约 2 天后的时间');
    }
  }

  private ensureReservationEndAfterStart(
    reservedAt: number,
    reservedEndAt: number,
  ): void {
    if (reservedEndAt <= reservedAt) {
      throw new BadRequestException('离店时间必须晚于预约时间');
    }
  }

  private isReservationExpiredForConflict(reservedAt: Date): boolean {
    return Date.now() >= reservedAt.getTime();
  }

  private toSpaceReservationResponse(
    reservation: SpaceReservationRecord,
  ): SpaceReservationResponseDto {
    const reservedAtMs = toTimestampMs(reservation.reservedAt);
    return {
      id: String(reservation.id),
      spaceId: String(reservation.spaceId),
      guestName: reservation.guestName,
      phone: reservation.phone ?? '',
      reservedAt: reservedAtMs,
      ...(reservation.reservedEndAt
        ? { reservedEndAt: toTimestampMs(reservation.reservedEndAt) }
        : {}),
      ...(reservation.guestCount !== null
        ? { guestCount: reservation.guestCount }
        : {}),
      ...(reservation.note ? { note: reservation.note } : {}),
      status: this.toSpaceReservationStatusValue(reservation.status),
      createdAt: toTimestampMs(reservation.createdAt),
      isOverdue: Date.now() >= reservedAtMs,
    };
  }

  private toSpaceReservationStatusValue(
    status: PrismaSpaceReservationStatus,
  ): SpaceReservationStatusValue {
    return status;
  }

  private getTodayRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

    return { start, end };
  }

  private async findSpacesByStore(
    storeId: number,
  ): Promise<SpaceWithRelations[]> {
    return this.prisma.space.findMany({
      where: { storeId },
      include: {
        type: {
          select: {
            id: true,
            name: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private buildEmptyDashboard(): SpacesDashboardResponseDto {
    return {
      stats: {
        total: 0,
        idle: 0,
        occupied: 0,
        reserved: 0,
        cleaning: 0,
        todaySettled: 0,
        todayRevenue: 0,
      },
      filterOptions: {
        types: [],
        zones: [],
        showDirtyTab: false,
      },
      spaces: [],
    };
  }

  private async buildDashboardSpaceSummaryBundle(
    storeId: number,
  ): Promise<DashboardSpaceSummaryBundle> {
    const now = Date.now();
    const todayRange = this.getTodayRange();
    const [activeSessions, pendingReservations] = await Promise.all([
      this.prisma.spaceSession.findMany({
        where: {
          storeId,
          status: PrismaSpaceSessionStatus.active,
        },
        select: {
          id: true,
          spaceId: true,
          guestName: true,
          guestPhone: true,
          guestCount: true,
          billingMode: true,
          startTime: true,
          hourlyRate: true,
          countdownMinutes: true,
          itemsCost: true,
          renewRecords: true,
          autoCheckout: true,
          prepaidPaymentMethod: true,
          prepaidGrouponCode: true,
          prepaidNote: true,
          prepaidAmount: true,
        },
        orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.spaceReservation.findMany({
        where: {
          storeId,
          status: PrismaSpaceReservationStatus.pending,
        },
        select: {
          id: true,
          spaceId: true,
          guestName: true,
          phone: true,
          guestCount: true,
          reservedAt: true,
          reservedEndAt: true,
        },
        orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const activeSessionSummaryBySpaceId = new Map<
      number,
      SpaceDashboardActiveSessionSummaryDto
    >();
    for (const session of activeSessions) {
      if (activeSessionSummaryBySpaceId.has(session.spaceId)) {
        continue;
      }

      activeSessionSummaryBySpaceId.set(
        session.spaceId,
        this.toSpaceDashboardActiveSessionSummary(session),
      );
    }

    const reservationsBySpaceId = new Map<number, typeof pendingReservations>();
    for (const reservation of pendingReservations) {
      const group = reservationsBySpaceId.get(reservation.spaceId);
      if (group) {
        group.push(reservation);
      } else {
        reservationsBySpaceId.set(reservation.spaceId, [reservation]);
      }
    }

    const activeReservationSummaryBySpaceId = new Map<
      number,
      SpaceDashboardReservationSummaryDto
    >();
    const futureReservationSummaryBySpaceId = new Map<
      number,
      SpaceDashboardReservationSummaryDto
    >();

    for (const [spaceId, reservations] of reservationsBySpaceId) {
      const upcomingTodayReservation = reservations.find(
        (reservation) =>
          reservation.reservedAt.getTime() > now &&
          reservation.reservedAt >= todayRange.start &&
          reservation.reservedAt <= todayRange.end,
      );
      const overdueReservation = reservations.find(
        (reservation) => reservation.reservedAt.getTime() <= now,
      );
      const activeReservation = upcomingTodayReservation ?? overdueReservation;
      if (activeReservation) {
        activeReservationSummaryBySpaceId.set(
          spaceId,
          this.toSpaceDashboardReservationSummary(
            activeReservation,
            activeReservation.reservedAt.getTime() <= now,
          ),
        );
      }

      const futureReservation = reservations.find(
        (reservation) => reservation.reservedAt > todayRange.end,
      );
      if (futureReservation) {
        futureReservationSummaryBySpaceId.set(
          spaceId,
          this.toSpaceDashboardReservationSummary(futureReservation),
        );
      }
    }

    return {
      activeSessionSummaryBySpaceId,
      activeReservationSummaryBySpaceId,
      futureReservationSummaryBySpaceId,
    };
  }

  private buildSpaceStats(
    spaces: SpaceWithRelations[],
    sessionStats: {
      todaySettled: number;
      todayRevenue: number;
    },
  ): SpaceStatsResponseDto {
    let idle = 0;
    let occupied = 0;
    let reserved = 0;
    let cleaning = 0;

    for (const space of spaces) {
      if (space.status === PrismaSpaceStatus.idle) {
        idle += 1;
      } else if (space.status === PrismaSpaceStatus.occupied) {
        occupied += 1;
      } else if (space.status === PrismaSpaceStatus.reserved) {
        reserved += 1;
      } else if (space.status === PrismaSpaceStatus.cleaning) {
        cleaning += 1;
      }
    }

    return {
      total: spaces.length,
      idle,
      occupied,
      reserved,
      cleaning,
      todaySettled: sessionStats.todaySettled,
      todayRevenue: sessionStats.todayRevenue,
    };
  }

  private async buildTodaySettledSessionStats(storeId: number): Promise<{
    todaySettled: number;
    todayRevenue: number;
  }> {
    const todayRange = this.getTodayRange();
    const sessions = await this.prisma.spaceSession.findMany({
      where: {
        storeId,
        status: PrismaSpaceSessionStatus.settled,
        endTime: {
          gte: todayRange.start,
          lte: todayRange.end,
        },
      },
      select: {
        id: true,
        items: true,
      },
    });

    return {
      todaySettled: sessions.length,
      todayRevenue: Number(
        sessions
          .reduce(
            (sum, session) =>
              sum +
              this.sumLineTotal(this.parseSpaceSessionItems(session.items)),
            0,
          )
          .toFixed(2),
      ),
    };
  }

  private buildFilterOptions(
    spaces: SpaceWithRelations[],
  ): SpaceDashboardFilterOptionsDto {
    const types = Array.from(
      new Set(spaces.map((space) => space.type.name)),
    ).sort();
    const zones = Array.from(
      new Set(
        spaces
          .map((space) => space.zone?.name)
          .filter((zone): zone is string => Boolean(zone)),
      ),
    ).sort();

    return {
      types,
      zones,
      showDirtyTab: spaces.some((space) => space.enableDirtyRoom),
    };
  }

  private toSpaceTypeResponse(item: SpaceTypeRecord): SpaceTypeResponseDto {
    return {
      id: String(item.id),
      name: item.name,
      createdAt: toTimestampMs(item.createdAt),
      updatedAt: toTimestampMs(item.updatedAt),
    };
  }

  private toSpaceZoneResponse(item: SpaceZoneRecord): SpaceZoneResponseDto {
    return {
      id: String(item.id),
      name: item.name,
      createdAt: toTimestampMs(item.createdAt),
      updatedAt: toTimestampMs(item.updatedAt),
    };
  }

  private toSpaceResponse(space: SpaceWithRelations): SpaceResponseDto {
    return {
      id: String(space.id),
      name: space.name,
      type: space.type.name,
      ...(space.zone
        ? {
            zone: space.zone.name,
          }
        : {}),
      ...(space.capacity !== null ? { capacity: space.capacity } : {}),
      enableDirtyRoom: space.enableDirtyRoom,
      autoCheckout: space.autoCheckout,
      status: this.toSpaceStatusValue(space.status),
      sortOrder: space.sortOrder,
      createdAt: toTimestampMs(space.createdAt),
    };
  }

  private toSpaceDashboardItem(
    space: SpaceWithRelations,
    summaries: DashboardSpaceSummaryBundle,
  ): SpaceDashboardSpaceItemDto {
    return {
      ...this.toSpaceResponse(space),
      ...(summaries.activeSessionSummaryBySpaceId.has(space.id)
        ? {
            activeSessionSummary: summaries.activeSessionSummaryBySpaceId.get(
              space.id,
            ),
          }
        : {}),
      ...(summaries.activeReservationSummaryBySpaceId.has(space.id)
        ? {
            activeReservationSummary:
              summaries.activeReservationSummaryBySpaceId.get(space.id),
          }
        : {}),
      ...(summaries.futureReservationSummaryBySpaceId.has(space.id)
        ? {
            futureReservationSummary:
              summaries.futureReservationSummaryBySpaceId.get(space.id),
          }
        : {}),
    };
  }

  private toSpaceDashboardActiveSessionSummary(session: {
    id: number;
    spaceId: number;
    guestName: string | null;
    guestPhone: string | null;
    guestCount: number | null;
    billingMode: PrismaSpaceBillingMode;
    startTime: Date;
    hourlyRate: Prisma.Decimal | null;
    countdownMinutes: number | null;
    itemsCost: Prisma.Decimal;
    renewRecords: Prisma.JsonValue;
    autoCheckout: boolean | null;
    prepaidPaymentMethod: SalesPaymentMethodValue | null;
    prepaidGrouponCode: string | null;
    prepaidNote: string | null;
    prepaidAmount: Prisma.Decimal | null;
  }): SpaceDashboardActiveSessionSummaryDto {
    return {
      sessionId: String(session.id),
      ...(session.guestName ? { guestName: session.guestName } : {}),
      ...(session.guestPhone ? { guestPhone: session.guestPhone } : {}),
      ...(session.guestCount !== null
        ? { guestCount: session.guestCount }
        : {}),
      billingMode: session.billingMode,
      startTime: toTimestampMs(session.startTime),
      ...(session.hourlyRate !== null
        ? { hourlyRate: Number(session.hourlyRate) }
        : {}),
      ...(session.countdownMinutes !== null
        ? { countdownMinutes: session.countdownMinutes }
        : {}),
      itemsCost: Number(session.itemsCost),
      renewCount: this.parseSpaceSessionRenewRecords(session.renewRecords)
        .length,
      ...(session.autoCheckout !== null
        ? { autoCheckout: session.autoCheckout }
        : {}),
      ...(session.prepaidPaymentMethod
        ? { prepaidPaymentMethod: session.prepaidPaymentMethod }
        : {}),
      ...(session.prepaidGrouponCode
        ? { prepaidGrouponCode: session.prepaidGrouponCode }
        : {}),
      ...(session.prepaidNote ? { prepaidNote: session.prepaidNote } : {}),
      ...(session.prepaidAmount !== null
        ? { prepaidAmount: Number(session.prepaidAmount) }
        : {}),
    };
  }

  private toSpaceDashboardReservationSummary(
    reservation: {
      id: number;
      guestName: string;
      phone: string | null;
      guestCount: number | null;
      reservedAt: Date;
      reservedEndAt: Date | null;
    },
    isOverdue?: boolean,
  ): SpaceDashboardReservationSummaryDto {
    return {
      reservationId: String(reservation.id),
      guestName: reservation.guestName,
      ...(reservation.phone ? { phone: reservation.phone } : {}),
      ...(reservation.guestCount !== null
        ? { guestCount: reservation.guestCount }
        : {}),
      reservedAt: toTimestampMs(reservation.reservedAt),
      ...(reservation.reservedEndAt
        ? { reservedEndAt: toTimestampMs(reservation.reservedEndAt) }
        : {}),
      ...(isOverdue !== undefined ? { isOverdue } : {}),
    };
  }

  private toSpaceStatusValue(status: PrismaSpaceStatus): SpaceStatusValue {
    return status;
  }

  private normalizeTargetSortOrder(value: number, max: number): number {
    const safeValue = Number.isInteger(value) ? value : 1;
    return Math.min(Math.max(safeValue, 1), Math.max(max, 1));
  }

  private async requireSpaceTypeByName(
    storeId: number,
    rawName: string,
  ): Promise<{ id: number; name: string }> {
    const name = rawName.trim();
    const type = await this.prisma.spaceType.findFirst({
      where: { storeId, name },
      select: {
        id: true,
        name: true,
      },
    });

    if (!type) {
      throw new NotFoundException('空间类型不存在');
    }

    return type;
  }

  private async findSpaceZoneByName(
    storeId: number,
    rawName: string | undefined,
  ): Promise<{ id: number; name: string } | null> {
    const name = rawName?.trim();
    if (!name) {
      return null;
    }

    const zone = await this.prisma.spaceZone.findFirst({
      where: { storeId, name },
      select: {
        id: true,
        name: true,
      },
    });

    if (!zone) {
      throw new NotFoundException('空间区域不存在');
    }

    return zone;
  }

  private async reorderSpaceSortOrder(
    transaction: Prisma.TransactionClient,
    storeId: number,
    spaceId: number,
    currentSortOrder: number,
    nextSortOrder: number,
  ): Promise<number> {
    const total = await transaction.space.count({
      where: { storeId },
    });
    const targetSortOrder = this.normalizeTargetSortOrder(nextSortOrder, total);

    if (targetSortOrder === currentSortOrder) {
      return targetSortOrder;
    }

    if (targetSortOrder < currentSortOrder) {
      await transaction.space.updateMany({
        where: {
          storeId,
          id: { not: spaceId },
          sortOrder: {
            gte: targetSortOrder,
            lt: currentSortOrder,
          },
        },
        data: {
          sortOrder: {
            increment: 1,
          },
        },
      });
      return targetSortOrder;
    }

    await transaction.space.updateMany({
      where: {
        storeId,
        id: { not: spaceId },
        sortOrder: {
          gt: currentSortOrder,
          lte: targetSortOrder,
        },
      },
      data: {
        sortOrder: {
          decrement: 1,
        },
      },
    });

    return targetSortOrder;
  }
}
