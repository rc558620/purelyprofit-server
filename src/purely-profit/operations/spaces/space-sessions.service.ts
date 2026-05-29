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
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  buildPaginationMeta,
  resolvePagination,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { SalesRecordService } from '../sales-record/sales-record.service';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from '../sales-record/dto/sales-record.dto';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
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
  type SpaceCustomerPaymentMethodValue,
  type SpaceSettlementChannelValue,
  type SpaceSettlementStatusValue,
  type SpaceTimeFeeModeValue,
  type SpaceSessionItemResponseDto,
  type SpaceSessionRenewRecordResponseDto,
  type SpaceSessionResponseDto,
  TransferSpaceSessionDto,
  type TransferSpaceSessionResponseDto,
} from './dto/space-session.dto';
import type {
  SpaceBillingModeValue,
  SpaceSessionStatusValue,
  SpaceStatusValue,
} from './spaces.constants';

export interface SpaceSessionItemRecord {
  productId: string;
  productName: string;
  categoryName: string;
  salePrice: number;
  profit: number;
  quantity: number;
}

export interface SpaceSessionRenewRecord {
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
  updatedAt: Date;
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

const SPACE_SESSION_CHECKOUT_LOCK_TTL_SECONDS = 5 * 60;

interface SpaceSessionCheckoutLockPayload {
  sessionId: number;
  lockedAt: number;
  expiresAt: number;
  sessionUpdatedAt: number;
  timeFeeMode?: SpaceTimeFeeModeValue;
  countdownFeeMode?: SpaceCountdownFeeModeValue;
}

interface CheckoutPreviewFeeMode {
  timeFeeMode?: SpaceTimeFeeModeValue;
  countdownFeeMode?: SpaceCountdownFeeModeValue;
}

interface NormalizedCheckoutPayload {
  paymentMethod: SalesPaymentMethodValue;
  note?: string;
  grouponCode?: string;
  grouponPlatform?: string;
  customerPaymentMethod?: SpaceCustomerPaymentMethodValue;
  settlementChannel?: SpaceSettlementChannelValue;
  voucherCode?: string;
  voucherPlatform?: string;
  voucherFaceAmount?: number;
  settlementStatus?: SpaceSettlementStatusValue;
  platformReceivable?: number;
  platformSettledAmount?: number;
  platformFee?: number;
  timeFeeMode?: SpaceTimeFeeModeValue;
  countdownFeeMode?: SpaceCountdownFeeModeValue;
  lockId: string;
  lockedAt: number;
}

const SPACE_CONTACT_PATTERN = /^[0-9+\-\s]{6,20}$/;
const MONEY_PRECISION_PATTERN = /^\d+(\.\d{1,2})?$/;

@Injectable()
export class SpaceSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly salesRecordService: SalesRecordService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

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
      status: query.status ?? PrismaSpaceSessionStatus.active,
      includeActive: true,
    };

    return this.listStoreSpaceSessionsByQuery(storeId, normalizedQuery);
  }

  async listStoreActiveSpaceSessions(
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
      status: query.status ?? PrismaSpaceSessionStatus.active,
      includeActive: true,
    };

    return this.listStoreSpaceSessionsByQuery(storeId, normalizedQuery);
  }

  private async listStoreSpaceSessionsByQuery(
    storeId: number,
    query: SpaceSessionListQuery,
  ): Promise<SpaceSessionResponseDto[]> {
    const where = this.buildStoreSpaceSessionListWhere(storeId, query);

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

    if (space.status === PrismaSpaceStatus.reserved) {
      const pendingReservation = await this.prisma.spaceReservation.findFirst({
        where: {
          spaceId: space.id,
          status: PrismaSpaceReservationStatus.pending,
        },
        select: { id: true },
      });

      if (!pendingReservation) {
        throw new ConflictException('空间预约状态异常，请刷新后重试');
      }
    }

    const payload = this.normalizeOpenSessionPayload(dto);
    this.ensureOpenSessionPayload(payload, space.capacity ?? undefined);

    if (payload.reservationId !== undefined) {
      await this.ensureReservationCanBeFulfilled(
        space.storeId,
        space.id,
        payload.reservationId,
      );
    }

    const session = await this.prisma.$transaction(async (transaction) => {
      if (space.status === PrismaSpaceStatus.reserved) {
        const latestPendingReservation =
          await transaction.spaceReservation.findFirst({
            where: {
              spaceId: space.id,
              status: PrismaSpaceReservationStatus.pending,
            },
            select: { id: true },
          });

        if (!latestPendingReservation) {
          throw new ConflictException('空间预约状态异常，请刷新后重试');
        }
      }

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
      ...(payload.grouponPlatform
        ? { grouponPlatform: payload.grouponPlatform }
        : {}),
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
    if (Boolean(session.autoCheckout) !== targetSpace.autoCheckout) {
      throw new ConflictException(
        '当前会话自动结账状态与目标空间设置不一致，无法换房',
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
      if (
        Boolean(latestSession.autoCheckout) !== latestTargetSpace.autoCheckout
      ) {
        throw new ConflictException(
          '当前会话自动结账状态与目标空间设置不一致，无法换房',
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
      sessionUpdatedAt: session.updatedAt.getTime(),
      ...(payload.timeFeeMode ? { timeFeeMode: payload.timeFeeMode } : {}),
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
        ...this.resolveCheckoutPreviewFeeMode(
          session.billingMode,
          payload,
          this.parseSpaceSessionRenewRecords(session.renewRecords),
        ),
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
          session.updatedAt.getTime(),
          payload.timeFeeMode,
          payload.countdownFeeMode,
        )
      : null;
    const checkoutAt = lockPayload?.lockedAt ?? payload.lockedAt ?? Date.now();
    if (checkoutAt < session.startTime.getTime()) {
      throw new BadRequestException('锁单时间不能早于开台时间');
    }

    const timeFeeMode = lockPayload?.timeFeeMode ?? payload.timeFeeMode;
    const countdownFeeMode =
      lockPayload?.countdownFeeMode ?? payload.countdownFeeMode;
    const items = this.parseSpaceSessionItems(session.items);
    const renewRecords = this.parseSpaceSessionRenewRecords(
      session.renewRecords,
    );
    const settlement = this.buildSpaceSessionSettlement({
      session,
      checkoutAt,
      payload: { timeFeeMode, countdownFeeMode },
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

      const cancelledReservationId =
        await this.cancelMatchedReservationAfterCheckout(transaction, session);
      const nextSpaceStatus = session.space.enableDirtyRoom
        ? PrismaSpaceStatus.cleaning
        : await this.resolveReservationBackStatus(transaction, session.spaceId);

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

  public parseSpaceSessionItems(
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

  public parseSpaceSessionRenewRecords(
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

  public sumLineTotal(items: SpaceSessionItemRecord[]): number {
    return Number(
      items
        .reduce((sum, item) => sum + item.salePrice * item.quantity, 0)
        .toFixed(2),
    );
  }

  public toSpaceSessionResponse(
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
    prepaidCustomerPaymentMethod?: SpaceCustomerPaymentMethodValue;
    prepaidSettlementChannel?: SpaceSettlementChannelValue;
    prepaidGrouponCode?: string;
    prepaidGrouponPlatform?: string;
    prepaidVoucherCode?: string;
    prepaidVoucherPlatform?: string;
    prepaidNote?: string;
    prepaidAmount?: number;
    prepaidVoucherFaceAmount?: number;
  } {
    const guestName = dto.guestName?.trim();
    const guestPhone = dto.guestPhone?.trim();
    const prepaidGrouponCode = dto.prepaidGrouponCode?.trim();
    const prepaidGrouponPlatform = dto.prepaidGrouponPlatform?.trim();
    const prepaidVoucherCode = dto.prepaidVoucherCode?.trim();
    const prepaidVoucherPlatform = dto.prepaidVoucherPlatform?.trim();
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
      ...(dto.prepaidCustomerPaymentMethod !== undefined
        ? { prepaidCustomerPaymentMethod: dto.prepaidCustomerPaymentMethod }
        : {}),
      ...(dto.prepaidSettlementChannel !== undefined
        ? { prepaidSettlementChannel: dto.prepaidSettlementChannel }
        : {}),
      ...(prepaidGrouponCode ? { prepaidGrouponCode } : {}),
      ...(prepaidGrouponPlatform ? { prepaidGrouponPlatform } : {}),
      ...(prepaidVoucherCode ? { prepaidVoucherCode } : {}),
      ...(prepaidVoucherPlatform ? { prepaidVoucherPlatform } : {}),
      ...(prepaidNote ? { prepaidNote } : {}),
      ...(dto.prepaidAmount !== undefined
        ? { prepaidAmount: dto.prepaidAmount }
        : {}),
      ...(dto.prepaidVoucherFaceAmount !== undefined
        ? { prepaidVoucherFaceAmount: dto.prepaidVoucherFaceAmount }
        : {}),
    };
  }

  private ensureOpenSessionPayload(
    payload: ReturnType<SpaceSessionsService['normalizeOpenSessionPayload']>,
    capacity?: number,
  ): void {
    if (payload.guestPhone && !SPACE_CONTACT_PATTERN.test(payload.guestPhone)) {
      throw new BadRequestException(
        '顾客电话格式不正确，请输入 6-20 位数字或常见联系电话格式',
      );
    }
    if (payload.guestCount !== undefined) {
      this.assertPositiveInteger(payload.guestCount, '顾客人数');
      if (capacity !== undefined && payload.guestCount > capacity) {
        throw new BadRequestException('顾客人数不能超过空间容量');
      }
    }

    if (payload.billingMode === 'timed' || payload.billingMode === 'mixed') {
      if (payload.hourlyRate === undefined || payload.hourlyRate <= 0) {
        throw new BadRequestException('请输入有效的计时单价');
      }
      this.assertMoneyPrecision(payload.hourlyRate, '计时单价');
    }

    if (payload.billingMode === 'countdown') {
      if (
        payload.countdownMinutes === undefined ||
        payload.countdownMinutes <= 0
      ) {
        throw new BadRequestException('请输入有效的倒计时时长');
      }
      this.assertPositiveInteger(payload.countdownMinutes, '倒计时时长');
      if (payload.hourlyRate === undefined || payload.hourlyRate <= 0) {
        throw new BadRequestException('请输入台位费');
      }
      this.assertMoneyPrecision(payload.hourlyRate, '台位费');
      if (payload.autoCheckout) {
        const prepaidVoucherCode =
          payload.prepaidVoucherCode ?? payload.prepaidGrouponCode;
        const prepaidVoucherPlatform =
          payload.prepaidVoucherPlatform ?? payload.prepaidGrouponPlatform;
        const prepaidVoucherFaceAmount =
          payload.prepaidVoucherFaceAmount ?? payload.prepaidAmount;
        const prepaidCustomerPaymentMethod =
          payload.prepaidCustomerPaymentMethod ??
          (prepaidVoucherCode || prepaidVoucherPlatform
            ? 'groupon_voucher'
            : payload.prepaidPaymentMethod);
        const prepaidSettlementChannel =
          payload.prepaidSettlementChannel ??
          (prepaidCustomerPaymentMethod === 'groupon_voucher'
            ? (() => {
                const normalized = prepaidVoucherPlatform?.trim().toLowerCase();
                if (!normalized) {
                  return 'other_platform' as const;
                }
                if (normalized.includes('美团')) {
                  return 'meituan_groupon' as const;
                }
                if (normalized.includes('抖音')) {
                  return 'douyin_groupon' as const;
                }
                return 'other_platform' as const;
              })()
            : 'direct_cashier');

        if (
          payload.prepaidPaymentMethod === undefined ||
          payload.prepaidAmount === undefined ||
          payload.prepaidAmount <= 0
        ) {
          throw new BadRequestException(
            '自动结账模式下请输入付款金额与支付方式',
          );
        }
        this.assertMoneyPrecision(payload.prepaidAmount, '预付金额');

        if (prepaidCustomerPaymentMethod === 'groupon_voucher') {
          this.assertRequiredNonEmpty(prepaidVoucherCode, '预付券码');
          this.assertRequiredNonEmpty(prepaidVoucherPlatform, '预付券所属平台');
          this.assertRequiredNonEmpty(prepaidSettlementChannel, '预付结算渠道');
          if (
            prepaidVoucherFaceAmount === undefined ||
            prepaidVoucherFaceAmount <= 0
          ) {
            throw new BadRequestException('预付券面金额必须大于 0');
          }
          this.assertMoneyPrecision(prepaidVoucherFaceAmount, '预付券面金额');
        }
      }
      return;
    }

    if (payload.autoCheckout) {
      throw new BadRequestException('仅倒计时会话支持自动结账');
    }
  }

  private normalizeCheckoutPreviewPayload(
    dto: CheckoutSpaceSessionPreviewDto,
  ): CheckoutPreviewFeeMode {
    const timeFeeMode = dto.timeFeeMode;
    const countdownFeeMode =
      dto.countdownFeeMode ??
      (timeFeeMode === 'unit_price'
        ? 'fixed'
        : timeFeeMode === 'timed'
          ? 'timed'
          : undefined);

    return {
      ...(timeFeeMode !== undefined ? { timeFeeMode } : {}),
      ...(countdownFeeMode !== undefined ? { countdownFeeMode } : {}),
    };
  }

  private normalizeCheckoutPayload(
    dto: CheckoutSpaceSessionDto,
  ): NormalizedCheckoutPayload {
    const note = dto.note?.trim();
    const grouponCode = dto.grouponCode?.trim();
    const grouponPlatform = dto.grouponPlatform?.trim();
    const voucherCode = dto.voucherCode?.trim();
    const voucherPlatform = dto.voucherPlatform?.trim();
    const lockId = dto.lockId.trim();
    const timeFeeMode = dto.timeFeeMode;
    const countdownFeeMode =
      dto.countdownFeeMode ??
      (timeFeeMode === 'unit_price'
        ? 'fixed'
        : timeFeeMode === 'timed'
          ? 'timed'
          : undefined);

    this.assertRequiredNonEmpty(lockId, '结账锁单');
    this.assertNonNegativeInteger(dto.lockedAt, '锁单时间');
    this.assertMoneyPrecision(dto.platformReceivable, '平台应收金额');
    this.assertMoneyPrecision(dto.platformSettledAmount, '平台已结金额');
    this.assertMoneyPrecision(dto.platformFee, '平台手续费');
    this.assertMoneyPrecision(dto.voucherFaceAmount, '券面金额');

    if (dto.customerPaymentMethod === 'groupon_voucher') {
      this.assertRequiredNonEmpty(voucherCode, '券码');
      this.assertRequiredNonEmpty(voucherPlatform, '券所属平台');
      this.assertRequiredNonEmpty(dto.settlementChannel, '结算渠道');
      if (dto.voucherFaceAmount === undefined || dto.voucherFaceAmount <= 0) {
        throw new BadRequestException('券面金额必须大于 0');
      }
    }

    if (
      dto.platformReceivable !== undefined &&
      dto.platformSettledAmount !== undefined &&
      dto.platformSettledAmount > dto.platformReceivable
    ) {
      throw new BadRequestException('平台已结金额不能大于平台应收金额');
    }
    if (
      dto.customerPaymentMethod === 'groupon_voucher' &&
      dto.voucherFaceAmount !== undefined &&
      dto.platformFee !== undefined &&
      dto.platformReceivable !== undefined &&
      dto.platformReceivable > dto.voucherFaceAmount - dto.platformFee
    ) {
      throw new BadRequestException('平台应收金额不能大于券面金额减手续费');
    }

    return {
      paymentMethod: dto.paymentMethod,
      ...(note ? { note } : {}),
      ...(grouponCode ? { grouponCode } : {}),
      ...(grouponPlatform ? { grouponPlatform } : {}),
      ...(dto.customerPaymentMethod !== undefined
        ? { customerPaymentMethod: dto.customerPaymentMethod }
        : {}),
      ...(dto.settlementChannel !== undefined
        ? { settlementChannel: dto.settlementChannel }
        : {}),
      ...(voucherCode ? { voucherCode } : {}),
      ...(voucherPlatform ? { voucherPlatform } : {}),
      ...(dto.voucherFaceAmount !== undefined
        ? { voucherFaceAmount: dto.voucherFaceAmount }
        : {}),
      ...(dto.settlementStatus !== undefined
        ? { settlementStatus: dto.settlementStatus }
        : {}),
      ...(dto.platformReceivable !== undefined
        ? { platformReceivable: dto.platformReceivable }
        : {}),
      ...(dto.platformSettledAmount !== undefined
        ? { platformSettledAmount: dto.platformSettledAmount }
        : {}),
      ...(dto.platformFee !== undefined
        ? { platformFee: dto.platformFee }
        : {}),
      ...(timeFeeMode !== undefined ? { timeFeeMode } : {}),
      ...(countdownFeeMode !== undefined ? { countdownFeeMode } : {}),
      lockId,
      lockedAt: dto.lockedAt,
    };
  }

  private buildSpaceSessionCheckoutLockKey(lockId: string): string {
    return `space:checkout-lock:${lockId}`;
  }

  private assertRequiredNonEmpty(
    value: string | undefined,
    label: string,
  ): void {
    if (!value) {
      throw new BadRequestException(`${label}不能为空`);
    }
  }

  private assertPositiveInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${label}必须是大于 0 的整数`);
    }
  }

  private assertNonNegativeInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${label}必须是不小于 0 的整数`);
    }
  }

  private assertMoneyPrecision(value: number | undefined, label: string): void {
    if (value === undefined) {
      return;
    }
    if (
      !Number.isFinite(value) ||
      !MONEY_PRECISION_PATTERN.test(String(value))
    ) {
      throw new BadRequestException(`${label}最多支持两位小数`);
    }
  }

  private async requireValidSpaceSessionCheckoutLock(
    sessionId: number,
    lockId: string,
    sessionUpdatedAt: number,
    timeFeeMode?: SpaceTimeFeeModeValue,
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
      typeof payload.expiresAt !== 'number' ||
      typeof payload.sessionUpdatedAt !== 'number'
    ) {
      throw new BadRequestException('锁单数据异常，请重新预览后再结账');
    }

    if (payload.sessionId !== sessionId) {
      throw new BadRequestException('锁单与当前会话不匹配');
    }
    if (payload.sessionUpdatedAt !== sessionUpdatedAt) {
      throw new BadRequestException('会话内容已变化，请重新预览后再结账');
    }

    const lockedTimeFeeMode =
      payload.timeFeeMode === 'timed' || payload.timeFeeMode === 'unit_price'
        ? payload.timeFeeMode
        : undefined;
    const lockedCountdownFeeMode =
      payload.countdownFeeMode === 'timed' ||
      payload.countdownFeeMode === 'fixed'
        ? payload.countdownFeeMode
        : undefined;
    if (
      timeFeeMode !== undefined &&
      lockedTimeFeeMode !== undefined &&
      lockedTimeFeeMode !== timeFeeMode
    ) {
      throw new BadRequestException('结账口径已变化，请重新预览后再结账');
    }
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
      sessionUpdatedAt: payload.sessionUpdatedAt,
      ...(lockedTimeFeeMode ? { timeFeeMode: lockedTimeFeeMode } : {}),
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
    payload: CheckoutPreviewFeeMode;
    items: SpaceSessionItemRecord[];
    renewRecords: SpaceSessionRenewRecord[];
  }): {
    durationMinutes: number;
    durationLabel: string;
    timeFeeMode?: SpaceTimeFeeModeValue;
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
    const resolvedFeeMode = this.resolveSpaceSessionFeeMode(
      session,
      renewRecords,
      payload,
    );
    const timeFeeMode = resolvedFeeMode.timeFeeMode;
    const countdownFeeMode = resolvedFeeMode.countdownFeeMode;
    let timeCost = 0;

    if (
      session.billingMode !== PrismaSpaceBillingMode.items &&
      session.hourlyRate !== null
    ) {
      const hourlyRate = Number(session.hourlyRate);
      const useUnitPrice = timeFeeMode === 'unit_price';
      timeCost = useUnitPrice
        ? hourlyRate
        : this.calcTimeCost(
            session.startTime.getTime(),
            checkoutAt,
            hourlyRate,
          );
      orderItems.unshift({
        productId: 'SYS_TIME_BILLING',
        productName: useUnitPrice
          ? '台位费（固定）'
          : `台位费（${durationLabel}）`,
        categoryName: '场地费',
        salePrice: timeCost,
        profit: timeCost,
        quantity: 1,
      });
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
      ...(timeFeeMode ? { timeFeeMode } : {}),
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

    return this.salesRecordService.create(user, dto, {
      // 追加点单时 session.items 已经扣过库存，结账只生成销售单，不再重复校验/扣减。
      skipInventoryValidationAndDeduction: true,
    });
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

  private resolveSpaceSessionFeeMode(
    session: Pick<SpaceSessionRecord, 'billingMode'>,
    renewRecords: SpaceSessionRenewRecord[],
    payload: CheckoutPreviewFeeMode,
  ): Required<CheckoutPreviewFeeMode> {
    if (session.billingMode === PrismaSpaceBillingMode.items) {
      return {
        timeFeeMode: 'timed',
        countdownFeeMode: 'timed',
      };
    }

    if (session.billingMode === PrismaSpaceBillingMode.countdown) {
      const countdownFeeMode =
        payload.countdownFeeMode ??
        (payload.timeFeeMode === 'unit_price'
          ? 'fixed'
          : payload.timeFeeMode === 'timed'
            ? 'timed'
            : renewRecords.length > 0
              ? 'timed'
              : 'fixed');

      return {
        timeFeeMode: countdownFeeMode === 'fixed' ? 'unit_price' : 'timed',
        countdownFeeMode,
      };
    }

    return {
      timeFeeMode: payload.timeFeeMode ?? 'timed',
      countdownFeeMode: payload.countdownFeeMode ?? 'timed',
    };
  }

  private resolveCheckoutPreviewFeeMode(
    billingMode: PrismaSpaceBillingMode,
    payload: CheckoutPreviewFeeMode,
    renewRecords: SpaceSessionRenewRecord[],
  ): CheckoutPreviewFeeMode {
    if (billingMode === PrismaSpaceBillingMode.items) {
      return {};
    }

    return this.resolveSpaceSessionFeeMode(
      { billingMode },
      renewRecords,
      payload,
    );
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

  private toSpaceSessionStatusValue(
    status: PrismaSpaceSessionStatus,
  ): SpaceSessionStatusValue {
    return status;
  }

  private toSpaceStatusValue(status: PrismaSpaceStatus): SpaceStatusValue {
    return status;
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
}
