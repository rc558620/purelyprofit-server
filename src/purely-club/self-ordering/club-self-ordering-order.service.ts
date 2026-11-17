// 自助下单建单服务：幂等闸门 → 门禁校验 → 服务端定价 → 事务内建单
//
// 相比扫码点餐刻意简化：无服务端购物车、无库存预留、无优惠/积分，
// 价格一律由服务端按 Product 重算并落快照（不信任客户端传价）。
// 保留的五件套：幂等键 + 事务 + 乐观锁 version + 会话校验 + 事务内建单。
//
// 本类只保留编排与读侧入口，协作边界如下：
// - 幂等闸门 → ClubSelfOrderingIdempotencyService
// - 业态 / 会话 / 会员时效 / 新客额度 → ClubSelfOrderingGateService
// - 商品定价与快照 → ClubSelfOrderingPricingService
// - 读侧字段白名单与游标分页 → club-self-ordering-order.query
// - 落库写入结构 → club-self-ordering-order.writer
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  CLUB_SELF_ORDERING_ERROR_CODE,
  clubSelfOrderingError,
} from './club-self-ordering.errors';
import { createSelfOrderNo } from './club-self-ordering.utils';
import { toSelfOrderResponse } from './club-self-ordering-order.mapper';
import { ClubSelfOrderingPricingService } from './club-self-ordering-pricing.service';
import { ClubSelfOrderingWechatVerifyService } from './club-self-ordering-wechat-verify.service';
import { ClubSelfOrderingIdempotencyService } from './club-self-ordering-order.idempotency.service';
import { ClubSelfOrderingGateService } from './club-self-ordering-order.gate.service';
import {
  buildSelfOrderListPage,
  planSelfOrderList,
  SELF_ORDER_LIST_SELECT,
} from './club-self-ordering-order.query';
import { buildSelfOrderCreateData } from './club-self-ordering-order.writer';
import type { CreateSelfOrderDto } from './dto/create-self-order.dto';
import type { ClubSelfOrderStatusQueryDto } from './dto/club-self-order-status-query.dto';
import type { ListSelfOrdersQueryDto } from './dto/list-self-orders.dto';
import type { SelfOrderCreation } from './club-self-ordering-order.types';

/** 待支付订单有效期：超时后不再允许发起支付 */
export const SELF_ORDER_PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable()
export class ClubSelfOrderingOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: ClubSelfOrderingPricingService,
    private readonly wechatVerifyService: ClubSelfOrderingWechatVerifyService,
    private readonly idempotency: ClubSelfOrderingIdempotencyService,
    private readonly gate: ClubSelfOrderingGateService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateSelfOrderDto,
    idempotencyKey: string | undefined,
  ): Promise<Record<string, unknown>> {
    const key = this.idempotency.requireKey(idempotencyKey);
    const replayed = await this.idempotency.replayExistingOrder(user.id, key);
    if (replayed) {
      return replayed;
    }

    const target = await this.gate.resolveOrderTarget(user, dto);
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
      const replay = await this.idempotency.replayAfterFailure(
        error,
        user.id,
        key,
      );
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

    // 详情与列表共用同一份字段白名单：`toSelfOrderResponse` 只消费
    // SELF_ORDER_LIST_SELECT 列出的字段，改回 `include: { items: true }`
    // 会把订单整行（幂等键 / 删除标记 / 审计列）与商品行整行一起拉回再丢弃。
    const order = await this.prisma.selfOrder.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      select: SELF_ORDER_LIST_SELECT,
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
   * 以 `hasMore` 明确告知是否还有下一页，深翻页成本由 keyset 游标保证恒定；
   * 列的裁剪、游标 spec 与分页组装统一收敛在 order.query。
   */
  async listBySession(
    user: AuthenticatedUser,
    query: ListSelfOrdersQueryDto,
  ): Promise<{
    items: Record<string, unknown>[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const plan = planSelfOrderList(user.id, query);
    // 多取一行判断是否还有下一页：比再查一次 count 便宜
    const rows = await this.prisma.selfOrder.findMany({
      where: plan.where,
      orderBy: plan.orderBy,
      take: plan.limit + 1,
      select: SELF_ORDER_LIST_SELECT,
    });
    return buildSelfOrderListPage(rows, plan.limit);
  }

  /**
   * 事务内建单：占位抢占 → 订单落库 → 新客额度扣减 → 幂等置成功。
   *
   * 四步必须同事务提交：任一步失败都整笔回滚，不能留下「有订单没扣额度」
   * 或「幂等已成功但订单不存在」的中间态。
   */
  private async persistOrder(
    user: AuthenticatedUser,
    creation: SelfOrderCreation,
  ): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(async (tx) => {
      // 先插占位记录抢占唯一索引，并发的兄弟请求会在此失败并走幂等回放
      await this.idempotency.reserveRecord(tx, user.id, creation);

      const order = await tx.selfOrder.create({
        data: buildSelfOrderCreateData(user.id, creation),
        // 建单回放同样只需要响应契约字段：投影与列表 / 详情保持一致，
        // 避免创建链路（含幂等快照写入）多拉一份内部列。
        select: SELF_ORDER_LIST_SELECT,
      });

      // 新客额度扣减与订单落库同事务提交，保证「服务的新客数」等于「扣掉的额度」
      await this.gate.consumeNewCustomerQuota(tx, creation.target, user);

      const response = toSelfOrderResponse(order);
      await this.idempotency.markSucceeded(tx, user.id, {
        key: creation.key,
        orderId: order.id,
        response,
      });
      return response;
    });
  }
}
