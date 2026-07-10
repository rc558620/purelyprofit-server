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
import {
  buildSpaceSessionSettlement,
  isSpaceSessionDeductionProductId,
} from './space-session-settlement.shared';
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
import {
  mapRenewRecordRows,
  mapSessionItemRows,
} from './space-sessions.mapper';
import type { SpaceTimeFeeModeValue } from './dto/space-session.constants';
import type { SpaceStatusValue } from './spaces.constants';

export interface SettleSpaceSessionParams {
  session: SpaceSessionSettlementRecord;
  checkoutAt: number;
  paymentMethod: SalesPaymentMethodValue;
  note?: string;
  settlement: SpaceSessionSettlement;
  renewRecords: SpaceSessionRenewRecord[];
  // ①②④ 修复：结账侧团购/券/平台结算字段，传入后更新 prepaid* 列
  grouponCode?: string;
  grouponPlatform?: string;
  customerPaymentMethod?: string;
  settlementChannel?: string;
  voucherCode?: string;
  voucherPlatform?: string;
  voucherFaceAmount?: number; // 元，落库转分
  // ① 修复：平台结算字段，落新列
  settlementStatus?: string;
  platformReceivable?: number; // 元，落库转分
  platformSettledAmount?: number; // 元，落库转分
  platformFee?: number; // 元，落库转分
  // ⑤ 修复：台位费口径审计字段
  timeFeeMode?: SpaceTimeFeeModeValue;
  /**
   * BUG-3 fix: 跳过将 voucherFaceAmount 写入 session.prepaidVoucherFaceAmount。
   * 当 voucherFaceAmount 来自续费团购回退（renewGrouponFallback）时设为 true，
   * 防止续费券面金额污染预付池字段，保持「两池独立」不变量。
   */
  skipPrepaidVoucherPersistence?: boolean;
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

          const createdOrder = await this.createSessionSaleOrder(user, {
            transaction,
            storeId: params.session.storeId,
            checkoutAt: params.checkoutAt,
            paymentMethod: params.paymentMethod,
            note: params.note,
            items: freshSettlement.orderItems,
            totalRevenue: freshSettlement.totalRevenue,
            totalProfit: freshSettlement.totalProfit,
            totalQuantity: freshSettlement.totalQuantity,
            // ─── 团购 / 券 / 平台结算字段透传到销售单 ───────────────────
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
              ? {
                  platformSettledAmount: params.platformSettledAmount,
                }
              : {}),
            ...(params.platformFee !== undefined
              ? { platformFee: params.platformFee }
              : {}),
          });

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
          // 如果结账时提供了新的团购/券/支付方式信息，更新 prepaid* 列（结账值为最终权威值）
          const checkoutSettlementData: Record<string, unknown> = {
            endTime: new Date(params.checkoutAt),
            // settlement 中的 timeCost/itemsCost 是元，DB 存储为分
            timeCost: Money.fromInputYuan(freshSettlement.timeCost).toDbCents(),
            itemsCost: Money.fromInputYuan(
              freshSettlement.itemsCost,
            ).toDbCents(),
            status: PrismaSpaceSessionStatus.settled,
            saleOrderId: Number(createdOrder.id),
          };

          // 结账时如果传了团购/券/支付方式，覆盖 prepaid* 列
          if (params.grouponCode !== undefined) {
            checkoutSettlementData.prepaidGrouponCode = params.grouponCode;
          }
          if (params.grouponPlatform !== undefined) {
            checkoutSettlementData.prepaidGrouponPlatform =
              params.grouponPlatform;
          }
          if (params.customerPaymentMethod !== undefined) {
            checkoutSettlementData.prepaidCustomerPaymentMethod =
              params.customerPaymentMethod;
          }
          if (params.settlementChannel !== undefined) {
            checkoutSettlementData.prepaidSettlementChannel =
              params.settlementChannel;
          }
          if (params.voucherCode !== undefined) {
            checkoutSettlementData.prepaidVoucherCode = params.voucherCode;
          }
          if (params.voucherPlatform !== undefined) {
            checkoutSettlementData.prepaidVoucherPlatform =
              params.voucherPlatform;
          }
          // BUG-3 fix: 当 voucherFaceAmount 来自续费回退时，不写入 session.prepaidVoucherFaceAmount，
          // 续费券面只属于续费池（spaceSessionRenewRecord），回写预付池会破坏「两池独立」不变量，
          // 导致重结/异常重试时双重抵扣。sale order 仍需 voucherFaceAmount 记录团购元数据。
          if (
            params.voucherFaceAmount !== undefined &&
            !params.skipPrepaidVoucherPersistence
          ) {
            checkoutSettlementData.prepaidVoucherFaceAmount =
              Money.fromInputYuan(params.voucherFaceAmount).toDbCents();
          }

          // ① 修复：平台结算字段落新列
          if (params.settlementStatus !== undefined) {
            checkoutSettlementData.settlementStatus = params.settlementStatus;
          }
          if (params.platformReceivable !== undefined) {
            checkoutSettlementData.platformReceivable = Money.fromInputYuan(
              params.platformReceivable,
            ).toDbCents();
          }
          if (params.platformSettledAmount !== undefined) {
            checkoutSettlementData.platformSettledAmount = Money.fromInputYuan(
              params.platformSettledAmount,
            ).toDbCents();
          }
          if (params.platformFee !== undefined) {
            checkoutSettlementData.platformFee = Money.fromInputYuan(
              params.platformFee,
            ).toDbCents();
          }

          // ⑤ 修复：台位费口径审计字段
          if (params.timeFeeMode !== undefined) {
            checkoutSettlementData.timeFeeMode = params.timeFeeMode;
          }

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
      // ─── 团购 / 券 / 平台结算元数据 ─────────────────────────────
      customerPaymentMethod?: string;
      grouponCode?: string;
      grouponPlatform?: string;
      settlementChannel?: string;
      voucherCode?: string;
      voucherPlatform?: string;
      voucherFaceAmount?: number;
      settlementStatus?: string;
      platformReceivable?: number;
      platformSettledAmount?: number;
      platformFee?: number;
    },
  ): Promise<SalesRecordResponseDto> {
    const dto: CreateSalesRecordDto = {
      storeId: params.storeId,
      // BUG-7 fix: 统一使用 productId 判定抵扣项，与 settlement.shared 口径一致
      items: params.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        salePrice: isSpaceSessionDeductionProductId(item.productId)
          ? Math.abs(item.salePrice)
          : item.salePrice,
        profit: isSpaceSessionDeductionProductId(item.productId)
          ? Math.abs(item.profit)
          : item.profit,
        quantity: item.quantity,
      })),
      paymentMethod: params.paymentMethod,
      calcMode: 'business',
      ...(params.note ? { note: params.note } : {}),
      date: params.checkoutAt,
      // ─── 团购 / 券 / 平台结算元数据透传 ─────────────────────────
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
        ? {
            platformSettledAmount: params.platformSettledAmount,
          }
        : {}),
      ...(params.platformFee !== undefined
        ? { platformFee: params.platformFee }
        : {}),
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
