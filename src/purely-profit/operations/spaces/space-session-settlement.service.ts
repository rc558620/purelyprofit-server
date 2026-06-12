import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisService } from '../../../redis/redis.service';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from '../sales-record/dto/sales-record.dto';
import { SalesRecordService } from '../sales-record/sales-record.service';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
import {
  toSpaceSessionItemsJson,
  toSpaceSessionRenewRecordsJson,
} from './space-sessions.mapper';
import type {
  SpaceSessionItemRecord,
  SpaceSessionRecord,
  SpaceSessionRenewRecord,
  SpaceSessionSettlement,
  SpaceSessionSettlementRecord,
} from './space-sessions.types';

export interface SettleSpaceSessionParams {
  session: SpaceSessionSettlementRecord;
  checkoutAt: number;
  paymentMethod: SalesPaymentMethodValue;
  note?: string;
  settlement: SpaceSessionSettlement;
  renewRecords: SpaceSessionRenewRecord[];
}

export interface SettleSpaceSessionResult {
  session: SpaceSessionRecord;
  spaceStatus: PrismaSpaceStatus;
  cancelledReservationId: number | null;
  salesOrder: SalesRecordResponseDto;
}

const SPACE_SESSION_SETTLEMENT_LOCK_TTL_SECONDS = 30;

@Injectable()
export class SpaceSessionSettlementService {
  private readonly logger = new Logger(SpaceSessionSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly salesRecordService: SalesRecordService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly redisService: RedisService,
  ) {}

  async settleSession(
    user: AuthenticatedUser,
    params: SettleSpaceSessionParams,
  ): Promise<SettleSpaceSessionResult> {
    const lock = await this.acquireSettlementLock(params.session.id);
    if (!lock) {
      throw new ConflictException('当前会话正在结账中，请稍后重试');
    }

    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT id
          FROM space_sessions
          WHERE id = ${params.session.id}
          FOR UPDATE
        `;
        await transaction.$queryRaw`
          SELECT id
          FROM spaces
          WHERE id = ${params.session.spaceId}
          FOR UPDATE
        `;

        const latestSession = await transaction.spaceSession.findUnique({
          where: { id: params.session.id },
          select: {
            status: true,
            updatedAt: true,
            reservationId: true,
            guestName: true,
            guestPhone: true,
            startTime: true,
            spaceId: true,
          },
        });

        if (!latestSession) {
          throw new NotFoundException('空间会话不存在');
        }

        if (latestSession.status !== PrismaSpaceSessionStatus.active) {
          throw new ConflictException('当前会话已结账，无法重复操作');
        }

        if (
          latestSession.updatedAt.getTime() !==
          params.session.updatedAt.getTime()
        ) {
          throw new ConflictException('当前会话已变更，请刷新后重试');
        }

        const latestSpace = await transaction.space.findUnique({
          where: { id: params.session.spaceId },
          select: {
            id: true,
            enableDirtyRoom: true,
          },
        });

        if (!latestSpace) {
          throw new NotFoundException('空间不存在');
        }

        const createdOrder = await this.createSessionSaleOrder(user, {
          transaction,
          storeId: params.session.storeId,
          checkoutAt: params.checkoutAt,
          paymentMethod: params.paymentMethod,
          note: params.note,
          items: params.settlement.orderItems,
          totalRevenue: params.settlement.totalRevenue,
          totalProfit: params.settlement.totalProfit,
          totalQuantity: params.settlement.totalQuantity,
        });

        const nextSession = await transaction.spaceSession.update({
          where: { id: params.session.id },
          data: {
            endTime: new Date(params.checkoutAt),
            timeCost: new Prisma.Decimal(params.settlement.timeCost),
            items: toSpaceSessionItemsJson(params.settlement.orderItems),
            itemsCost: new Prisma.Decimal(params.settlement.itemsCost),
            renewRecords: toSpaceSessionRenewRecordsJson(params.renewRecords),
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
          await this.cancelMatchedReservationAfterCheckout(transaction, {
            reservationId: latestSession.reservationId,
            guestName: latestSession.guestName,
            guestPhone: latestSession.guestPhone,
            startTime: latestSession.startTime,
            spaceId: latestSession.spaceId,
          });
        const nextSpaceStatus = latestSpace.enableDirtyRoom
          ? PrismaSpaceStatus.cleaning
          : await this.resolveReservationBackStatus(
              transaction,
              params.session.spaceId,
            );

        await transaction.space.update({
          where: { id: params.session.spaceId },
          data: {
            status: nextSpaceStatus,
          },
        });

        return {
          session: nextSession,
          spaceStatus: nextSpaceStatus,
          cancelledReservationId,
          salesOrder: createdOrder,
        };
      });

      await this.cacheInvalidatorService.invalidateSalesDerived(
        params.session.storeId,
      );

      return updated;
    } finally {
      try {
        await this.releaseSettlementLock(lock);
      } catch (error) {
        this.logger.warn(
          `releaseSettlementLock failed sessionId=${params.session.id} reason=${error instanceof Error ? error.name : 'UnknownError'}`,
        );
      }
    }
  }

  private async createSessionSaleOrder(
    user: AuthenticatedUser,
    params: {
      transaction: Prisma.TransactionClient;
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
      // 结账权限已在 checkout service 层以 operation-entry:create 完成验证，无需再检查 sales:create。
      skipAccessCheck: true,
      // 主账号/店长代客结账时，应优先归属到当前待交班班次员工，避免逾期未交班后账目落到下一班。
      assignToCurrentShiftOperator: true,
      transactionClient: params.transaction,
    });
  }

  private async cancelMatchedReservationAfterCheckout(
    transaction: Prisma.TransactionClient,
    session: {
      reservationId: number | null;
      guestName: string | null;
      guestPhone: string | null;
      startTime: Date;
      spaceId: number;
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

    const sortedCandidates = candidates.sort(
      (a, b) =>
        Math.abs(a.reservedAt.getTime() - session.startTime.getTime()) -
        Math.abs(b.reservedAt.getTime() - session.startTime.getTime()),
    );

    for (const candidate of sortedCandidates) {
      const updated = await transaction.spaceReservation.updateMany({
        where: {
          id: candidate.id,
          status: PrismaSpaceReservationStatus.pending,
        },
        data: {
          status: PrismaSpaceReservationStatus.cancelled,
        },
      });

      if (updated.count > 0) {
        return candidate.id;
      }
    }

    return null;
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

  private async acquireSettlementLock(
    sessionId: number,
  ): Promise<{ key: string; token: string } | null> {
    const token = randomUUID();
    const lockKey = `space:settlement:session:${sessionId}`;
    const result = await this.redisService
      .getClient()
      .set(
        lockKey,
        token,
        'EX',
        SPACE_SESSION_SETTLEMENT_LOCK_TTL_SECONDS,
        'NX',
      );

    return result === 'OK'
      ? {
          key: lockKey,
          token,
        }
      : null;
  }

  private async releaseSettlementLock(lock: {
    key: string;
    token: string;
  }): Promise<void> {
    await this.redisService.getClient().eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `,
      1,
      lock.key,
      lock.token,
    );
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
