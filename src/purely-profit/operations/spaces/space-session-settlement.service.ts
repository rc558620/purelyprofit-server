import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { isDeductionProductName } from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import { PrismaService, TX_TIMEOUT_LONG } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisService } from '../../../redis/redis.service';
import type {
  CreateSalesRecordDto,
  SalesRecordResponseDto,
} from '../sales-record/dto/sales-record.dto';
import { SalesRecordService } from '../sales-record/sales-record.service';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
import type {
  SpaceSessionItemRecord,
  SpaceSessionRecord,
  SpaceSessionRenewRecord,
  SpaceSessionSettlement,
  SpaceSessionSettlementRecord,
} from './space-sessions.types';
import type { SpaceReservationSessionSnapshot } from './space-reservations.types';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import type { SpaceStatusValue } from './spaces.constants';

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
  cancelledReservationId: number | null;
  salesOrder: SalesRecordResponseDto;
  /** 事务内推导的结算后空间状态（BUG-8 修复：保证与写入一致） */
  spaceStatus: SpaceStatusValue;
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
    private readonly reservationsStateService: SpaceReservationsStateService,
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

        // Step 8.1: 删除旧 items，重新写入结算时的 items
        await transaction.spaceSessionItem.deleteMany({
          where: { sessionId: params.session.id },
        });
        await transaction.spaceSessionItem.createMany({
          data: params.settlement.orderItems.map((item, index) => ({
            sessionId: params.session.id,
            productId: item.productId,
            productName: item.productName,
            categoryName: item.categoryName,
            // orderItems 中的 salePrice/profit 是元，DB 存储为分
            // 抵扣项在结算中为负数，DB 中存正数（代表已收到的预付款/续费金额）
            salePrice: isDeductionProductName(item.productName)
              ? Money.fromInputYuan(Math.abs(item.salePrice)).toDbCents()
              : Money.fromInputYuan(item.salePrice).toDbCents(),
            profit: isDeductionProductName(item.productName)
              ? Money.fromInputYuan(Math.abs(item.profit)).toDbCents()
              : Money.fromInputYuan(item.profit).toDbCents(),
            quantity: item.quantity,
            sortOrder: index,
          })),
        });

        // Step 8.1: renewRecords 已经在 renew 时写入了独立表
        // 结算时不需要重新写入 renewRecords

        const nextSession = await transaction.spaceSession.update({
          where: { id: params.session.id },
          data: {
            endTime: new Date(params.checkoutAt),
            // settlement 中的 timeCost/itemsCost 是元，DB 存储为分
            timeCost: Money.fromInputYuan(params.settlement.timeCost).toDbCents(),
            itemsCost: Money.fromInputYuan(params.settlement.itemsCost).toDbCents(),
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
            sessionItems: {
              orderBy: { sortOrder: 'asc' },
            },
            sessionRenewRecords: {
              orderBy: { id: 'asc' },
            },
          },
        });

        const cancelledReservationId =
          await this.reservationsStateService.cancelMatchedReservationAfterCheckout(
            transaction,
            {
              reservationId: latestSession.reservationId,
              guestName: latestSession.guestName,
              guestPhone: latestSession.guestPhone,
              startTime: latestSession.startTime,
              spaceId: latestSession.spaceId,
            } satisfies SpaceReservationSessionSnapshot,
          );

        // BUG-8 修复：在事务内推导空间状态，保证与写入数据一致
        const spaceStatus =
          await this.reservationsStateService.resolveReservationBackStatus(
            transaction,
            params.session.spaceId,
            latestSpace.enableDirtyRoom,
          );

        return {
          session: nextSession as unknown as SpaceSessionRecord,
          cancelledReservationId,
          salesOrder: createdOrder,
          spaceStatus: spaceStatus as SpaceStatusValue,
        };
      }, { timeout: TX_TIMEOUT_LONG });

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
      // 抵扣项（预付款/续费抵扣）在结算计算中为负数（减少客人应付），
      // 但在销售明细中应以正数存储——它们代表已收到的钱（预付款/续费金额），
      // 而非折扣或退款。前端直接展示，严禁做任何金额计算。
      items: params.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        salePrice: isDeductionProductName(item.productName)
          ? Math.abs(item.salePrice)
          : item.salePrice,
        profit: isDeductionProductName(item.productName)
          ? Math.abs(item.profit)
          : item.profit,
        quantity: item.quantity,
      })),
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
      // 会话中的商品价格可能与当前目录价格不一致（如开台后调价），应使用会话记录的价格。
      preserveCallerPrices: true,
      transactionClient: params.transaction,
      // 抵扣项在 items 中以正数存储（代表已收到的预付款/续费），
      // 但 SaleOrder.totalRevenue 必须反映实际结算金额（消费 - 抵扣，可能为负数），
      // 因此使用结算层计算的权威值覆盖聚合结果。
      totalRevenueOverride: params.totalRevenue,
      totalProfitOverride: params.totalProfit,
    });
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
}
