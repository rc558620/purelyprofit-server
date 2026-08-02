import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { buildCheckoutSettlementData } from './space-session-checkout-data.shared';
import {
  buildSpaceSessionSettlement,
  isSpaceSessionDeductionProductId,
} from './space-session-settlement.shared';
import { Money } from '../../../shared/money.utils';
import { PrismaService, TX_TIMEOUT_LONG } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisService } from '../../../redis/redis.service';
import {
  acquireSettlementLock,
  releaseSettlementLock,
} from './space-session-settlement-lock.shared';
import type { SpaceReservationSessionSnapshot } from './space-reservations.types';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import {
  mapRenewRecordRows,
  mapSessionItemRows,
} from './space-sessions.mapper';
import { createAutoCheckoutSystemUser } from './space-session-auto-checkout.service';
import { SpaceSessionSaleOrderService } from './space-session-sale-order.service';
import { MarketingConsumptionLinkService } from '../../marketing/marketing-consumption-link.service';
import type {
  SettleSpaceSessionParams,
  SettleSpaceSessionResult,
} from './space-session-settlement.types';

@Injectable()
export class SpaceSessionSettlementService {
  private readonly logger = new Logger(SpaceSessionSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly saleOrderService: SpaceSessionSaleOrderService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly redisService: RedisService,
    private readonly reservationsStateService: SpaceReservationsStateService,
    private readonly marketingConsumptionLinkService: MarketingConsumptionLinkService,
  ) {}

  async settleSession(
    user: AuthenticatedUser,
    params: SettleSpaceSessionParams,
  ): Promise<SettleSpaceSessionResult> {
    const lock = await acquireSettlementLock(this.redisService, params.session.id);
    if (!lock) {
      throw new ConflictException('当前会话正在结账中，请稍后重试');
    }

    try {
      const updated = await this.prisma.$transaction(
        async (transaction) => {
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

          // BUG-1 fix: 事务内重读 sessionItems / renewRecords，以事务内最新数据重建 settlement，
          // 避免事务外预加载快照与实际数据不一致导致并发追加的商品被静默删除。
          const txSessionItems = await transaction.spaceSessionItem.findMany({
            where: { sessionId: params.session.id },
            orderBy: { sortOrder: 'asc' },
          });
          const txRenewRecords =
            await transaction.spaceSessionRenewRecord.findMany({
              where: { sessionId: params.session.id },
              orderBy: { id: 'asc' },
            });
          const freshSettlement = buildSpaceSessionSettlement({
            session: params.session,
            checkoutAt: params.checkoutAt,
            payload: {
              timeFeeMode: params.settlement.timeFeeMode,
              countdownFeeMode: params.settlement.countdownFeeMode,
            },
            items: mapSessionItemRows(txSessionItems),
            renewRecords: mapRenewRecordRows(txRenewRecords),
          });

          // BUG-fix: autoCheckout 会话统一使用系统用户创建销售单，
          // 确保 SaleOrder.operatorStaffId 为 null，交班页显示"空间自动结账"，
          // 无论结账由前端倒计时触发还是后端调度器触发。
          const effectiveUser = params.session.autoCheckout
            ? createAutoCheckoutSystemUser()
            : user;

          const createdOrder = await this.saleOrderService.create(
            effectiveUser,
            {
              transaction,
              storeId: params.session.storeId,
              checkoutAt: params.checkoutAt,
              paymentMethod: params.paymentMethod,
              note: params.note,
              items: freshSettlement.orderItems,
              totalRevenue: freshSettlement.totalRevenue,
              totalProfit: freshSettlement.totalProfit,
              totalQuantity: freshSettlement.totalQuantity,
              ...(params.customerPaymentMethod !== undefined
                ? { customerPaymentMethod: params.customerPaymentMethod }
                : {}),
              ...(params.grouponCode !== undefined
                ? { grouponCode: params.grouponCode }
                : {}),
              ...(params.grouponPlatform !== undefined
                ? { grouponPlatform: params.grouponPlatform }
                : {}),
              ...(params.settlementChannel !== undefined
                ? { settlementChannel: params.settlementChannel }
                : {}),
              ...(params.voucherCode !== undefined
                ? { voucherCode: params.voucherCode }
                : {}),
              ...(params.voucherPlatform !== undefined
                ? { voucherPlatform: params.voucherPlatform }
                : {}),
              ...(params.voucherFaceAmount !== undefined
                ? { voucherFaceAmount: params.voucherFaceAmount }
                : {}),
              ...(params.settlementStatus !== undefined
                ? { settlementStatus: params.settlementStatus }
                : {}),
              ...(params.platformReceivable !== undefined
                ? { platformReceivable: params.platformReceivable }
                : {}),
              ...(params.platformSettledAmount !== undefined
                ? { platformSettledAmount: params.platformSettledAmount }
                : {}),
              ...(params.platformFee !== undefined
                ? { platformFee: params.platformFee }
                : {}),
            },
          );

          // F9: 空间结算联动营销中心——按手机号创建/关联会员并写入消费流水
          // （无手机号或结算金额 <= 0 时内部跳过）
          await this.marketingConsumptionLinkService.linkSpaceSettlementConsumption(
            transaction,
            {
              storeId: params.session.storeId,
              guestName: latestSession.guestName,
              guestPhone: latestSession.guestPhone,
              totalRevenueYuan: freshSettlement.totalRevenue,
              paymentMethod: params.paymentMethod,
              checkoutAt: params.checkoutAt,
              itemsSummary: freshSettlement.orderItems
                .map((item) => item.productName)
                .join('、'),
            },
          );

          // Step 8.1: 删除旧 items，重新写入结算时的 items
          await transaction.spaceSessionItem.deleteMany({
            where: { sessionId: params.session.id },
          });
          await transaction.spaceSessionItem.createMany({
            data: freshSettlement.orderItems.map((item, index) => ({
              sessionId: params.session.id,
              productId: item.productId,
              productName: item.productName,
              categoryName: item.categoryName,
              // BUG-7 fix: 统一使用 productId 判定抵扣项，避免 productName 文案变更后判定静默失效
              salePrice: isSpaceSessionDeductionProductId(item.productId)
                ? Money.fromInputYuan(Math.abs(item.salePrice)).toDbCents()
                : Money.fromInputYuan(item.salePrice).toDbCents(),
              profit: isSpaceSessionDeductionProductId(item.productId)
                ? Money.fromInputYuan(Math.abs(item.profit)).toDbCents()
                : Money.fromInputYuan(item.profit).toDbCents(),
              quantity: item.quantity,
              sortOrder: index,
            })),
          });

          // Step 8.1: renewRecords 已经在 renew 时写入了独立表
          // 结算时不需要重新写入 renewRecords

          // ①②④ 修复：结账侧团购/券/平台字段落库
          const checkoutSettlementData = buildCheckoutSettlementData({
            checkoutAt: params.checkoutAt,
            freshSettlement,
            saleOrderId: Number(createdOrder.id),
            grouponCode: params.grouponCode,
            grouponPlatform: params.grouponPlatform,
            customerPaymentMethod: params.customerPaymentMethod,
            settlementChannel: params.settlementChannel,
            voucherCode: params.voucherCode,
            voucherPlatform: params.voucherPlatform,
            voucherFaceAmount: params.voucherFaceAmount,
            skipPrepaidVoucherPersistence: params.skipPrepaidVoucherPersistence,
            settlementStatus: params.settlementStatus,
            platformReceivable: params.platformReceivable,
            platformSettledAmount: params.platformSettledAmount,
            platformFee: params.platformFee,
            timeFeeMode: params.timeFeeMode,
          });

          const nextSession = await transaction.spaceSession.update({
            where: { id: params.session.id },
            data: checkoutSettlementData,
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
        },
        { timeout: TX_TIMEOUT_LONG },
      );

      await this.cacheInvalidatorService.invalidateSalesDerived(
        params.session.storeId,
      );

      // F9: 空间结算可能新增/更新了营销会员，失效营销中心衍生缓存
      await this.marketingConsumptionLinkService.invalidateMarketingDerived(
        params.session.storeId,
      );

      return updated;
    } finally {
      try {
        await releaseSettlementLock(this.redisService, lock);
      } catch (error) {
        this.logger.warn(
          `releaseSettlementLock failed sessionId=${params.session.id} reason=${error instanceof Error ? error.name : 'UnknownError'}`,
        );
      }
    }
  }
}
