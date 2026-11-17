// 自助下单建单服务：幂等闸门 → 门禁校验 → 服务端定价（ClubSelfOrderingPricingService）→ 事务内建单
//
// 相比扫码点餐刻意简化：无服务端购物车、无库存预留、无优惠/积分，
// 价格一律由服务端按 Product 重算并落快照（不信任客户端传价）。
// 保留的五件套：幂等键 + 事务 + 乐观锁 version + 会话校验 + 事务内建单。
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CLUB_SELF_ORDERING_ERROR_CODE,
  clubSelfOrderingError,
} from './club-self-ordering.errors';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { MembershipDowngradeService } from '../../purely-profit/member/platform-membership/membership-downgrade.service';
import { SELF_ORDER_BLOCKED_MESSAGE } from '../../purely-profit/member/platform-membership/membership-downgrade.messages';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import {
  assertGeneralStoreForSelfOrdering,
  createSelfOrderNo,
  hashSelfOrderRequest,
} from './club-self-ordering.utils';
import {
  toSelfOrderResponse,
  type SelfOrderIdempotencyRecord,
} from './club-self-ordering-order.mapper';
import { ClubSelfOrderingPricingService } from './club-self-ordering-pricing.service';
import type { SelfOrderPricingResult } from './club-self-ordering-pricing.service';
import { ClubSelfOrderingWechatVerifyService } from './club-self-ordering-wechat-verify.service';
import type { CreateSelfOrderDto } from './dto/create-self-order.dto';
import type { ClubSelfOrderStatusQueryDto } from './dto/club-self-order-status-query.dto';
import type { ListSelfOrdersQueryDto } from './dto/list-self-orders.dto';
import {
  SELF_ORDER_LIST_DEFAULT_LIMIT,
  SELF_ORDER_LIST_MAX_LIMIT,
} from './dto/list-self-orders.dto';
import { resolveCursorLimit } from '../../shared/cursor-pagination.utils';
import {
  buildClubKeysetWhere,
  decodeClubCursor,
  encodeClubCursor,
  type ClubCursorKeySpec,
} from '../shared/club-keyset-cursor.util';

const IDEMPOTENCY_SCOPE = 'club:self-order:create';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * processing 占位记录的存活租约：进程在占位插入后崩溃/超时会留下永不完成的
 * processing 记录，阻塞同键重试直到 TTL。超过租约视为过期删除并允许重建——
 * 任何存活事务远早于 60s 完成，删除只可能命中崩溃残留，不会误删在途兄弟请求。
 */
const IDEMPOTENCY_PROCESSING_LEASE_MS = 60 * 1000;
/** 待支付订单有效期：超时后不再允许发起支付 */
export const SELF_ORDER_PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * 历史列表排序键：`createdAt` 落库即固定，配 `id` 兜底构成全序，
 * 保证翻页不漏不重（同一事务内写入的多行 createdAt 相同）。
 */
const SELF_ORDER_LIST_CURSOR_KEYS: ReadonlyArray<ClubCursorKeySpec> = [
  { field: 'createdAt', nullable: false },
];

/** 历史列表排序（与 SELF_ORDER_LIST_CURSOR_KEYS 同序） */
const SELF_ORDER_LIST_ORDER_BY: Prisma.SelfOrderOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

/**
 * 历史列表字段白名单：显式列出前端契约需要的列。
 *
 * 改前用 `include: { items: true }` 会把订单整行（含幂等键、删除标记等
 * 内部字段）和商品行整行全部拉回再丢弃，50 条时属于明显的无效 IO。
 */
const SELF_ORDER_LIST_SELECT = {
  id: true,
  orderNo: true,
  storeId: true,
  sessionId: true,
  spaceId: true,
  remark: true,
  itemTotalAmount: true,
  payableAmount: true,
  status: true,
  paymentStatus: true,
  version: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      productName: true,
      categoryName: true,
      salePrice: true,
      quantity: true,
      specSignature: true,
    },
  },
} as const satisfies Prisma.SelfOrderSelect;

/** 通过四道门禁后的落库锚点（门店 / 会话 / 空间） */
interface SelfOrderTarget {
  storeId: number;
  sessionId: number;
  spaceId: number;
}

/** 一次建单所需的全部事实：幂等键、入参、锚点、定价结果、订单号 */
interface SelfOrderCreation {
  key: string;
  dto: CreateSelfOrderDto;
  target: SelfOrderTarget;
  priced: SelfOrderPricingResult;
  orderNo: string;
}

@Injectable()
export class ClubSelfOrderingOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
    private readonly downgradeService: MembershipDowngradeService,
    private readonly quotaService: ClubNewCustomerQuotaService,
    private readonly wechatVerifyService: ClubSelfOrderingWechatVerifyService,
    private readonly pricingService: ClubSelfOrderingPricingService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateSelfOrderDto,
    idempotencyKey: string | undefined,
  ): Promise<Record<string, unknown>> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const replayed = await this.replayExistingOrder(user.id, key);
    if (replayed) {
      return replayed;
    }

    const target = await this.resolveTarget(user, dto);
    const priced = await this.pricingService.priceItems(
      target.storeId,
      dto.items,
    );

    try {
      return await this.persistOrder(user, {
        key,
        dto,
        target,
        priced,
        orderNo: createSelfOrderNo(),
      });
    } catch (error) {
      const replay = await this.replayAfterFailure(error, user.id, key);
      if (replay) {
        return replay;
      }
      throw error;
    }
  }

  /**
   * 查询订单详情（带归属校验）。
   *
   * verify=true 时先回微信侧核对并补落账，再读本地状态：
   * 前端在拉起支付后结果未知（unknown）时用这个入口确认用户是否已扣款。
   */
  async findOwnedOrder(
    user: AuthenticatedUser,
    orderId: number,
    query?: ClubSelfOrderStatusQueryDto,
  ): Promise<Record<string, unknown>> {
    if (query?.verify === true) {
      await this.wechatVerifyService.verifyAndSettle(user.id, orderId);
    }

    const order = await this.prisma.selfOrder.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      include: { items: true },
    });
    if (!order)
      throw new NotFoundException(
        clubSelfOrderingError(
          CLUB_SELF_ORDERING_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
          '订单不存在',
        ),
      );
    return toSelfOrderResponse(order);
  }

  /**
   * 会话维度的历史订单（游标分页）。
   *
   * 改造前是 `take: 50` 硬上限且返回裸数组：超过 50 笔之后更早的订单永远拿不到，
   * 前端也没有「还有更多」的依据。改为 keyset 游标后深翻页成本恒定，
   * 并用 `hasMore` 明确告知是否还有下一页。
   */
  async listBySession(
    user: AuthenticatedUser,
    query: ListSelfOrdersQueryDto,
  ): Promise<{
    items: Record<string, unknown>[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = resolveCursorLimit(query.limit, {
      defaultLimit: SELF_ORDER_LIST_DEFAULT_LIMIT,
      maxLimit: SELF_ORDER_LIST_MAX_LIMIT,
    });
    const position = decodeClubCursor(
      query.cursor,
      SELF_ORDER_LIST_CURSOR_KEYS,
    );

    const where: Prisma.SelfOrderWhereInput = {
      sessionId: query.sessionId,
      clubUserId: user.id,
      deletedAt: null,
      ...(position
        ? buildClubKeysetWhere<Prisma.SelfOrderWhereInput>(
            SELF_ORDER_LIST_CURSOR_KEYS,
            position,
          )
        : {}),
    };

    // 多取一行判断是否还有下一页：比再查一次 count 便宜
    const rows = await this.prisma.selfOrder.findMany({
      where,
      orderBy: SELF_ORDER_LIST_ORDER_BY,
      take: limit + 1,
      select: SELF_ORDER_LIST_SELECT,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;

    return {
      items: pageRows.map((order) => toSelfOrderResponse(order)),
      nextCursor:
        hasMore && lastRow
          ? encodeClubCursor([lastRow.createdAt], lastRow.id)
          : null,
      hasMore,
    };
  }

  // ─── 幂等闸门 ─────────────────────────────────────────────────────────────

  private requireIdempotencyKey(idempotencyKey: string | undefined): string {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new ConflictException(
        clubSelfOrderingError(
          CLUB_SELF_ORDERING_ERROR_CODE.PARAM_IDEMPOTENCY_KEY_INVALID,
          '请提供有效的 Idempotency-Key 以创建订单',
        ),
      );
    }
    return idempotencyKey.trim();
  }

  /** 同键已建单直接回放；崩溃残留的 processing 占位过期后删除并允许重建 */
  private async replayExistingOrder(
    actorId: number,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: this.idempotencyWhere(actorId, key),
    });
    if (!existing) {
      return null;
    }

    if (
      existing.status === 'processing' &&
      Date.now() - existing.updatedAt.getTime() >
        IDEMPOTENCY_PROCESSING_LEASE_MS
    ) {
      await this.prisma.idempotencyRecord.deleteMany({
        where: {
          ...this.idempotencyWhere(actorId, key),
          status: 'processing',
          updatedAt: {
            lt: new Date(Date.now() - IDEMPOTENCY_PROCESSING_LEASE_MS),
          },
        },
      });
      return null;
    }

    return this.resolveExistingIdempotency(existing);
  }

  /** 建单失败时的兜底：兄弟请求可能已建单成功，回放其结果 */
  private async replayAfterFailure(
    error: unknown,
    actorId: number,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    if (error instanceof ConflictException) {
      return null;
    }
    const created = await this.prisma.idempotencyRecord.findUnique({
      where: this.idempotencyWhere(actorId, key),
    });
    return created ? this.resolveExistingIdempotency(created) : null;
  }

  // ─── 门禁与落库 ───────────────────────────────────────────────────────────

  /**
   * 四道门禁：业态 / 会话归属 / 会员时效 / 新客额度。
   *
   * 会话必须 active 且属于当前门店：杜绝把订单挂到别家门店或已结账的会话。
   * 新客额度闸门与扫码点餐同一口径：额度归属取本次下单所在门店——这位顾客若是新客，
   * 为其认证手机号的成本就由这家门店承担；他若已在别家店认证过，
   * 则不再扣额度、也不受本店额度是否为 0 影响。
   */
  private async resolveTarget(
    user: AuthenticatedUser,
    dto: CreateSelfOrderDto,
  ): Promise<SelfOrderTarget> {
    const currentContext =
      await this.currentStoreContextService.requireCurrentContext(user);
    const storeId = currentContext.store.id;

    // 与扫码定位/菜单同一道业态门禁：餐饮门店走既有扫码点餐链路
    assertGeneralStoreForSelfOrdering(currentContext.store);

    const session = await this.prisma.spaceSession.findFirst({
      where: { id: dto.sessionId, storeId, status: 'active' },
      select: { id: true, spaceId: true, createdAt: true },
    });
    if (!session) {
      throw new ForbiddenException(
        clubSelfOrderingError(
          CLUB_SELF_ORDERING_ERROR_CODE.AUTH_SESSION_UNAVAILABLE,
          '当前空间会话不可用，请重新扫码',
        ),
      );
    }

    // 会员过期门店停止新的下单流程；到期之前已开台的会话允许继续下单
    await this.downgradeService.assertStoreCanOrder(
      storeId,
      SELF_ORDER_BLOCKED_MESSAGE,
      session.createdAt,
    );
    await this.quotaService.assertAvailableForOrder(storeId, user.id);

    return { storeId, sessionId: session.id, spaceId: session.spaceId };
  }

  private async persistOrder(
    user: AuthenticatedUser,
    creation: SelfOrderCreation,
  ): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(async (tx) => {
      // 先插占位记录抢占唯一索引，并发的兄弟请求会在此失败并走幂等回放
      await this.reserveIdempotencyRecord(tx, user.id, creation);

      const { orderId, response } = await this.createOrderRow(
        tx,
        user.id,
        creation,
      );

      // 新客额度扣减：与订单落库在同一个事务里提交。
      // 扣不到额度（并发下被别人抢走最后一个）就抛错让整笔建单回滚，
      // 保证「服务的新客数」严格等于「扣掉的额度」。老客在此直接放行。
      await this.quotaService.consumeWithinOrderTransaction(
        tx,
        creation.target.storeId,
        user.id,
        user.phone || null,
      );

      await this.markIdempotencySucceeded(tx, user.id, {
        key: creation.key,
        orderId,
        response,
      });
      return response;
    });
  }

  private async reserveIdempotencyRecord(
    tx: Prisma.TransactionClient,
    actorId: number,
    creation: SelfOrderCreation,
  ): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        scope: IDEMPOTENCY_SCOPE,
        actorId,
        idempotencyKey: creation.key,
        requestHash: hashSelfOrderRequest({
          sessionId: creation.dto.sessionId,
          // 用定价后的结果：同商品多行已合并，避免因行顺序不同算出不同指纹
          // 必须纳入 specSignature：同商品不同规格是不同订单，指纹不同才能在
          // 同幂等键下被识别为「内容不一致」而不是回放错误订单
          items: creation.priced.items.map((item) => [
            item.productId,
            item.specSignature ?? '',
            item.quantity,
          ]),
          remark: creation.dto.remark ?? null,
        }),
        status: 'processing',
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  }

  private async createOrderRow(
    tx: Prisma.TransactionClient,
    actorId: number,
    creation: SelfOrderCreation,
  ): Promise<{ orderId: number; response: Record<string, unknown> }> {
    const order = await tx.selfOrder.create({
      data: {
        storeId: creation.target.storeId,
        orderNo: creation.orderNo,
        sessionId: creation.target.sessionId,
        spaceId: creation.target.spaceId,
        clubUserId: actorId,
        remark: creation.dto.remark?.trim() || null,
        idempotencyKey: creation.key,
        itemTotalAmount: creation.priced.itemTotalAmount,
        payableAmount: creation.priced.payableAmount,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        items: {
          create: creation.priced.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            categoryName: item.categoryName,
            salePrice: item.salePrice,
            costPrice: item.costPrice,
            quantity: item.quantity,
            specSignature: item.specSignature,
            ...(item.specOptions.length > 0
              ? {
                  specs: {
                    create: item.specOptions.map((spec) => ({
                      specOptionId: spec.id,
                      specOptionNameSnapshot: spec.name,
                      extraPriceSnapshot: spec.extraPrice,
                    })),
                  },
                }
              : {}),
          })),
        },
      },
      include: { items: true },
    });
    return { orderId: order.id, response: toSelfOrderResponse(order) };
  }

  private async markIdempotencySucceeded(
    tx: Prisma.TransactionClient,
    actorId: number,
    params: {
      key: string;
      orderId: number;
      response: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.idempotencyRecord.update({
      where: this.idempotencyWhere(actorId, params.key),
      data: {
        status: 'succeeded',
        resourceType: 'self_order',
        resourceId: params.orderId,
        responseSnapshot: params.response as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private idempotencyWhere(actorId: number, key: string) {
    return {
      scope_actorId_idempotencyKey: {
        scope: IDEMPOTENCY_SCOPE,
        actorId,
        idempotencyKey: key,
      },
    };
  }

  // ─── 映射 ─────────────────────────────────────────────────────────────────

  private resolveExistingIdempotency(
    record: SelfOrderIdempotencyRecord,
  ): Record<string, unknown> {
    if (record.status === 'succeeded' && record.responseSnapshot) {
      return record.responseSnapshot as Record<string, unknown>;
    }
    throw new ConflictException(
      clubSelfOrderingError(
        CLUB_SELF_ORDERING_ERROR_CODE.STATUS_ORDER_CREATING,
        '订单正在创建中，请稍后重试',
      ),
    );
  }
}
