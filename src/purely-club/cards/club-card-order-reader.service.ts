/**
 * C 端购卡订单读取：本人订单定位、幂等命中订单、落账后重读、订单首张卡。
 *
 * 只做读，不做任何状态流转；越权边界收敛在「clubUserId = 当前登录者」，
 * 定位不到一律 404，不区分「不存在」与「不是你的」，避免探测他人订单。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { MemberCardOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { parseCardId } from './club-card-code.utils';
import { CLUB_CARD_ERROR_CODE, clubCardError } from './club-cards.errors';
import {
  CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE,
  CLUB_CARD_ORDER_NOT_FOUND_MESSAGE,
} from './club-cards.constants';
import { toOrderView } from './club-cards.mapper';
import type { ClubMemberCardOrderView } from './club-cards.types';

@Injectable()
export class ClubCardOrderReaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: ClubOrderIdempotencyService,
  ) {}

  /**
   * 按订单标识定位**本人**订单：支持订单号（MC 开头）与数据库自增 ID。
   *
   * C 端前端把下单返回的 `id`（= orderNo）原样拼进 URL，
   * 兼容数字 ID 是为了历史深链与人工排查方便。
   */
  async findOwnedOrder(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<MemberCardOrder> {
    const trimmed = orderId.trim();
    const numericId = parseCardId(trimmed);
    const order = await this.prisma.memberCardOrder.findFirst({
      where: {
        clubUserId: currentContext.user.id,
        ...(numericId === null
          ? { orderNo: trimmed }
          : { OR: [{ id: numericId }, { orderNo: trimmed }] }),
      },
    });

    if (!order) {
      throw this.buildOrderNotFoundError();
    }
    return order;
  }

  /** 按订单号查单（支付回调入口用：回调只认微信流水对应的订单号，不限定归属） */
  async findByOrderNo(orderNo: string): Promise<MemberCardOrder | null> {
    return this.prisma.memberCardOrder.findUnique({ where: { orderNo } });
  }

  /**
   * 幂等键命中的已建订单。
   *
   * 复用响应刻意不带 `paymentParams`：同一 out_trade_no 不能拿去第二次
   * JSAPI 下单，前端拿到旧参数会直接拉起支付并报错。
   */
  async findReusableOrder(
    clubUserId: number,
    idempotencyKey: string,
  ): Promise<ClubMemberCardOrderView | null> {
    const orderNo = await this.idempotencyService.findOrderNo({
      scope: CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE,
      userId: clubUserId,
      key: idempotencyKey,
    });
    if (!orderNo) {
      return null;
    }

    const order = await this.prisma.memberCardOrder.findFirst({
      where: { orderNo, clubUserId },
    });
    if (!order) {
      return null;
    }

    return toOrderView({
      order,
      cardId: await this.findFirstCardId(order.id),
    });
  }

  /** 落账后重读订单（保证响应与库内状态一致） */
  async reloadOrder(orderId: number): Promise<MemberCardOrder> {
    const order = await this.prisma.memberCardOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw this.buildOrderNotFoundError();
    }
    return order;
  }

  /** 订单下首张卡（历史一单一卡，取 id 最小的一条） */
  async findFirstCardId(orderId: number): Promise<string | null> {
    const card = await this.prisma.memberCard.findFirst({
      where: { orderId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return card ? String(card.id) : null;
  }

  private buildOrderNotFoundError(): NotFoundException {
    return new NotFoundException(
      clubCardError(
        CLUB_CARD_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
        CLUB_CARD_ORDER_NOT_FOUND_MESSAGE,
      ),
    );
  }
}
