/**
 * 扫码点餐建单流程编排。
 *
 * 从 `ClubScanOrderingOrderService.create` 的整体抽出：主服务只保留「门面」职责，
 * 流程按「幂等校验 → 会话 / 门店 / 新客额度闸门 → 定价校验 → 占位 → 建单事务
 * → 回填快照 → 实时通知」逐段落实，每段都可单独推演。
 *
 * 依赖以 `CreateOrderFlowDeps` 透传而非另建 Nest Provider：建单链路的依赖全部由
 * `ClubScanOrderingOrderService` 已经注入，多包一层 Provider 只会把装配噪音搬来搬去。
 */
import { ConflictException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import type { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import type { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import type { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import type { ClubScanOrderingInventoryReservationService } from './club-scan-ordering-inventory-reservation.service';
import type { CreateClubScanOrderDto } from './dto/club-scan-ordering.dto';
import { hashScanOrderRequest } from './club-scan-ordering-order.utils';
import {
  assertStoreConsistency,
  loadCreateSession,
} from './club-scan-ordering-order-session.helper';
import {
  createIdempotencyPlaceholder,
  discardIdempotencyPlaceholder,
  finalizeIdempotencyPlaceholder,
  findIdempotencyRecord,
  resolveExistingIdempotencyResponse,
} from './club-scan-ordering-idempotency.helper';
import {
  IDEMPOTENCY_SCOPE,
  PAYMENT_TIMEOUT_MS,
  buildOrderCreatedPayload,
  createOrderStatusHistoryRow,
  createScanOrderRow,
  markCartItemsOrdered,
} from './club-scan-ordering-order-create.helper';
import type {
  CreateOrderPricing,
  CreateOrderSession,
  CreatedScanOrderResponse,
} from './club-scan-ordering-order-create.helper';

/** 建单流程依赖（由门面服务透传，保持依赖来源单一） */
export interface CreateOrderFlowDeps {
  prisma: PrismaService;
  quotaService: ClubNewCustomerQuotaService;
  currentStoreContextService: ClubCurrentStoreContextService;
  cartPricingService: ClubScanOrderingCartPricingService;
  inventoryReservationService: ClubScanOrderingInventoryReservationService;
  realtimeService: ScanOrderingRealtimeService;
  logger: Logger;
}

export interface CreateOrderFlowInput {
  user: AuthenticatedUser;
  idempotencyKey: string | undefined;
  dto: CreateClubScanOrderDto;
}

/** 幂等占位结果：占位成功拿到记录 ID，撞键则回放既有响应 */
type IdempotencyReservation =
  | { kind: 'reserved'; id: number }
  | { kind: 'existing'; response: unknown };

/** 建单事务入参：业务闸门都已通过，这里只负责落库 */
interface CommitOrderInput {
  user: AuthenticatedUser;
  dto: CreateClubScanOrderDto;
  session: CreateOrderSession;
  pricing: CreateOrderPricing;
  idempotencyKey: string;
  expiresAt: Date;
}

/** 幂等建单入口：返回订单响应，或同 key 重放首次成功的快照。 */
export const createClubScanOrder = async (
  deps: CreateOrderFlowDeps,
  input: CreateOrderFlowInput,
): Promise<unknown> => {
  const { user, dto } = input;
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const replayed = await inspectIdempotency(
    deps.prisma,
    user.id,
    idempotencyKey,
  );
  if (replayed) return resolveExistingIdempotencyResponse(replayed);

  const session = await loadCreateSession(deps.prisma, {
    clubUserId: user.id,
    sessionId: dto.sessionId,
  });
  await assertStoreConsistency(
    deps.currentStoreContextService,
    user,
    session.storeId,
  );
  // 新客额度闸门：额度耗尽时禁止下单，商家充值后才能继续。
  // 刻意放在定价之前——被拦时不必白算一轮价格与促销。
  await deps.quotaService.assertAvailableForOrder(session.storeId, user.id);

  const pricing = await priceAndValidateCart(deps, { user, session, dto });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAYMENT_TIMEOUT_MS);
  const reservation = await reserveIdempotency(deps, {
    actorId: user.id,
    idempotencyKey,
    dto,
    expiresAt,
  });
  if (reservation.kind === 'existing') return reservation.response;

  let result: CreatedScanOrderResponse;
  try {
    result = await commitOrder(deps, {
      user,
      dto,
      session,
      pricing,
      idempotencyKey,
      expiresAt,
    });
  } catch (error) {
    // 事务确定未提交：删掉占位记录，允许同 key 重试（订单不存在，删了不会丢单）
    await discardIdempotencyPlaceholder(
      deps.prisma,
      reservation.id,
      deps.logger,
    );
    if (error instanceof ConflictException) throw error;
    const raced = await inspectIdempotency(
      deps.prisma,
      user.id,
      idempotencyKey,
    );
    if (raced) return resolveExistingIdempotencyResponse(raced);
    throw error;
  }

  // 事务已提交：从这里开始的失败都不得再删占位记录（订单已真实存在）。
  // 回填失败只记日志，记录停在 processing 时同 key 重试会拿到「正在创建中」。
  await finalizeIdempotencyPlaceholder(
    deps.prisma,
    reservation.id,
    result,
    deps.logger,
    result.id,
  );

  deps.logger.log(
    `订单已落库，准备发布 order.created: orderId=${result.id}, storeId=${session.storeId}, sessionId=${session.id}, pid=${process.pid}`,
  );
  // 菜单库存不再由 menuVersion 承载：库存 / 销量由 MenuStockService 的 5s
  // 快照独立刷新，下单路径因此无需失效菜单缓存。
  deps.realtimeService.publishOrderCreated(
    buildOrderCreatedPayload({
      session,
      order: result,
      pricedItems: pricing.pricedItems,
      amountFen: pricing.promotionResult.afterPointsPayableAmount,
      remark: dto.remark,
      createdAt: now,
    }),
  );
  return result;
};

/** Idempotency-Key 必填：缺失或过短一律拒绝，避免重复提交绕过幂等。 */
const requireIdempotencyKey = (idempotencyKey: string | undefined): string => {
  if (!idempotencyKey || idempotencyKey.trim().length < 8) {
    throw new ConflictException(
      clubScanOrderingError(
        CLUB_SCAN_ORDERING_ERROR_CODE.PARAM_IDEMPOTENCY_KEY_INVALID,
        '请提供有效的 Idempotency-Key 以创建订单',
      ),
    );
  }
  return idempotencyKey;
};

const inspectIdempotency = (
  prisma: PrismaService,
  actorId: number,
  idempotencyKey: string,
) =>
  findIdempotencyRecord(prisma, {
    scope: IDEMPOTENCY_SCOPE,
    actorId,
    idempotencyKey,
  });

/** 定价 + 版本一致性校验 + 促销与金额计算（下单前唯一取数口）。 */
const priceAndValidateCart = async (
  deps: CreateOrderFlowDeps,
  input: {
    user: AuthenticatedUser;
    session: CreateOrderSession;
    dto: CreateClubScanOrderDto;
  },
): Promise<CreateOrderPricing> => {
  const { user, session, dto } = input;
  // 定价与定价版本共用一次取数（省掉版本计算的重复查询）
  const { items: pricedItems, pricingVersion } =
    await deps.cartPricingService.priceCartWithPricingVersion(
      session.id,
      session.storeId,
    );
  const cartVersion = deps.cartPricingService.cartVersion(pricedItems);
  if (cartVersion !== dto.cartVersion) {
    throw new ConflictException(
      clubScanOrderingError(
        CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_CART_UPDATED,
        '购物车已更新，请刷新后重新确认订单',
      ),
    );
  }
  if (dto.pricingVersion !== pricingVersion) {
    throw new ConflictException(
      clubScanOrderingError(
        CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_PRICE_CHANGED,
        '订单价格已变化，请重新确认订单',
      ),
    );
  }
  // 下单是写路径：允许在此补建 / 认领顾客档案（预览已不再建档）
  const promotionResult = await deps.cartPricingService.resolvePromotions({
    storeId: session.storeId,
    clubUserId: user.id,
    pricedItems,
    usePoints: dto.usePoints === true,
    customerLookup: 'ensure',
  });
  const amounts = deps.cartPricingService.calculateAmounts(
    pricedItems,
    promotionResult,
  );
  return { pricingVersion, pricedItems, promotionResult, amounts };
};

/**
 * 幂等占位记录提到建单事务外：唯一键本身就是并发闸门，不需要与订单同事务。
 * 建单事务因此从 9 次往返降到 7 次，menu_product / spec_option / session /
 * 新客额度这些行锁的持有时间同比缩短。占位失败（唯一键冲突）按「并发同 key」
 * 处理，与改造前 `tx.idempotencyRecord.create` 抛错后的分支完全一致。
 */
const reserveIdempotency = async (
  deps: CreateOrderFlowDeps,
  input: {
    actorId: number;
    idempotencyKey: string;
    dto: CreateClubScanOrderDto;
    expiresAt: Date;
  },
): Promise<IdempotencyReservation> => {
  try {
    const id = await createIdempotencyPlaceholder(deps.prisma, {
      scope: IDEMPOTENCY_SCOPE,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hashScanOrderRequest(input.dto),
      expiresAt: input.expiresAt,
    });
    return { kind: 'reserved', id };
  } catch (error) {
    const raced = await inspectIdempotency(
      deps.prisma,
      input.actorId,
      input.idempotencyKey,
    );
    if (raced) {
      return {
        kind: 'existing',
        response: resolveExistingIdempotencyResponse(raced),
      };
    }
    throw error;
  }
};

/** 建单事务编排：库存预留与订单落库同事务，要么全成要么全不成。 */
const commitOrder = (
  deps: CreateOrderFlowDeps,
  input: CommitOrderInput,
): Promise<CreatedScanOrderResponse> =>
  deps.prisma.$transaction((tx) => createOrderInTransaction(deps, tx, input), {
    timeout: TX_TIMEOUT_MEDIUM,
  });

const createOrderInTransaction = async (
  deps: CreateOrderFlowDeps,
  tx: Prisma.TransactionClient,
  input: CommitOrderInput,
): Promise<CreatedScanOrderResponse> => {
  const { user, dto, session, pricing } = input;
  await deps.inventoryReservationService.reserveMenuProductStock(
    tx,
    pricing.pricedItems,
    session.storeId,
  );
  await deps.cartPricingService.reserveFiniteSpecStock(tx, pricing.pricedItems);
  await tx.scanOrderingSession.update({
    where: { id: session.id },
    data: {
      guestCount: Math.max(session.guestCount, dto.guestCount),
      lastActiveAt: new Date(),
    },
  });
  const order = await createScanOrderRow(tx, {
    session,
    dto,
    pricing,
    clubUserId: user.id,
    idempotencyKey: input.idempotencyKey,
    expiresAt: input.expiresAt,
    items: deps.cartPricingService.buildOrderItemCreateData(
      pricing.pricedItems,
      pricing.amounts.productDiscountAmount,
      session.storeId,
    ),
  });
  await createOrderStatusHistoryRow(tx, order.id, session, user.id);
  await markCartItemsOrdered(tx, session.id);
  // 新客额度扣减与订单落库同事务提交：扣不到（并发抢走最后一个）就让整笔
  // 建单回滚，保证「服务的新客数」严格等于「扣掉的额度」。老客在此直接放行。
  await deps.quotaService.consumeWithinOrderTransaction(
    tx,
    session.storeId,
    user.id,
    user.phone || null,
  );
  return order;
};
