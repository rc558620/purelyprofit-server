// 团购券下单前置：上下文解析 → 新客额度闸门 → 算价 → 顾客快照 → 支付意图（JSAPI 参数）
//
// 从 ClubVoucherOrderPaymentService 拆出的原因：这一段全部是「下单前必须算清楚的事」，
// 与「幂等占位 + 落库 + 失败回滚」是两种性质的工作。拆开后下单服务只负责编排顺序，
// 算价口径改动不会再与幂等/事务代码互相干扰。
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CLUB_VOUCHER_ERROR_CODE,
  clubVoucherError,
} from './club-voucher-orders.errors';
import type { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import {
  buildClubMemberDisplayName,
  getDisplayPhone,
} from '../../purely-profit/auth/auth.utils';
import { ClubOrderPreviewBreakdownService } from '../orders/club-order-preview-breakdown.service';
import type { ClubOrderBreakdownItemDto } from '../orders/dto/club-order.dto';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import { ClubVoucherOrderContextService } from './club-voucher-order-context.service';
import type {
  ClubVoucherOrderContext,
  ClubVoucherPricing,
} from './club-voucher-order-context.service';
import { buildVoucherOrderNo } from './club-voucher-order-code.utils';
import { buildVoucherOrderBreakdownItems } from './club-voucher-order-payment.helper';
import type { ClubVoucherOrderDraftView } from './club-voucher-order-payment.types';
import { CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE } from './club-voucher-orders.constants';
import type { CreateClubVoucherOrderDto } from './dto/club-voucher-order.dto';

/**
 * 下单前半段的中间结果：把「算价」与「落库 / 发起支付」拆开的载体。
 * 含顾客信息快照，避免落库时再把这些值从 context 里重新推导一遍。
 */
export interface VoucherOrderDraftPreparation {
  context: ClubVoucherOrderContext;
  quantity: number;
  personCount: number;
  pricing: ClubVoucherPricing;
  orderNo: string;
  guestName: string | null;
  guestPhone: string | null;
  breakdownItems: ClubOrderBreakdownItemDto[];
  paymentMethod: 'wechat' | 'balance';
  remark: string | undefined;
}

/** 支付发起结果：仅微信渠道会产出 JSAPI 参数 */
export type VoucherOrderPaymentParams =
  ClubVoucherOrderDraftView['paymentParams'];

/** 下单前置产出：草稿 + 需要回给前端的支付参数 */
export interface VoucherOrderDraftPlan {
  draft: VoucherOrderDraftPreparation;
  paymentParams: VoucherOrderPaymentParams;
}

@Injectable()
export class ClubVoucherOrderDraftService {
  constructor(
    private readonly clubVoucherOrderContextService: ClubVoucherOrderContextService,
    private readonly breakdownService: ClubOrderPreviewBreakdownService,
    private readonly quotaService: ClubNewCustomerQuotaService,
    private readonly clubPaymentModeService: ClubPaymentModeService,
    private readonly clubWechatOpenidService: ClubWechatOpenidService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
  ) {}

  /** 先算价、再决定这次下单要不要真的向微信预下单 */
  async prepare(
    currentContext: ClubCurrentContext,
    dto: CreateClubVoucherOrderDto,
  ): Promise<VoucherOrderDraftPlan> {
    const draft = await this.buildDraft(currentContext, dto);
    const paymentParams = await this.resolvePaymentIntent(
      currentContext,
      dto,
      draft,
    );
    return { draft, paymentParams };
  }

  /**
   * 新客额度扣减：必须与订单落库同事务，扣不到就整单回滚。
   *
   * 额度域整体留在本 service（预检 + 扣减），下单服务只负责在事务里按顺序调用，
   * 避免两处各自持有额度写法导致「预检口径」与「扣减口径」漂移。
   */
  async consumeQuotaWithinTransaction(
    tx: Prisma.TransactionClient,
    storeId: number,
    userId: number,
    phone: string | null,
  ): Promise<void> {
    await this.quotaService.consumeWithinOrderTransaction(
      tx,
      storeId,
      userId,
      phone,
    );
  }

  /**
   * 解析下单上下文并完成算价。
   *
   * 新客额度闸门放在算价之前：被拦时不必白算一轮促销与积分。
   * 额度归属取本次下单所在门店（context 已校验等于当前门店）：该顾客若尚未在
   * 任何门店消耗过额度，就由这家门店承担额度；已在别家店认证过则直接放行。
   */
  private async buildDraft(
    currentContext: ClubCurrentContext,
    dto: CreateClubVoucherOrderDto,
  ): Promise<VoucherOrderDraftPreparation> {
    const context = await this.clubVoucherOrderContextService.resolveContext(
      currentContext,
      dto,
    );
    await this.quotaService.assertAvailableForOrder(
      context.store.id,
      currentContext.user.id,
    );

    const quantity = dto.quantity ?? 1;
    const personCount = dto.personCount ?? context.product.personCount ?? 1;
    const pricing = await this.clubVoucherOrderContextService.resolvePricing(
      context,
      quantity,
      dto.usePoints === true,
    );

    if (context.product.stock < quantity) {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.RULE_STOCK_NOT_ENOUGH,
          CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE,
        ),
      );
    }

    // 顾客信息快照：静默微信登录拿不到昵称（user.name 为 null），
    // 姓名兜底为「纯利会员+标识后4位」（与营销顾客档案命名规则一致），
    // 保证商家端订单卡与开台回填都有可识别的顾客名；电话仅快照真实手机号。
    const guestSnapshot = this.resolveGuestSnapshot(currentContext.user);

    return {
      context,
      quantity,
      personCount,
      pricing,
      orderNo: buildVoucherOrderNo(Date.now()),
      guestName: guestSnapshot.guestName,
      guestPhone: guestSnapshot.guestPhone,
      breakdownItems: buildVoucherOrderBreakdownItems(
        this.breakdownService,
        pricing,
      ),
      paymentMethod: dto.paymentMethod ?? 'wechat',
      remark: dto.remark,
    };
  }

  /**
   * 决定这次下单要不要真的向微信预下单。
   *
   * 测试模式不向微信预下单：订单照常落 unpaid，前端改由 confirm-paid 生成券码并
   * 扣库存。预下单要求门店已配置收款，门店没配时会抛 STORE_PAY_CONFIG_MISSING——
   * 测试模式用不到支付参数，不该被它拦死。
   * 余额支付无需微信下单参数，直接落 unpaid 后在同一请求内完成结算。
   */
  private async resolvePaymentIntent(
    currentContext: ClubCurrentContext,
    dto: CreateClubVoucherOrderDto,
    draft: VoucherOrderDraftPreparation,
  ): Promise<VoucherOrderPaymentParams> {
    // 余额支付：下单即扣款，余额不足直接拒绝（避免落库 unpaid 脏单）
    if (
      draft.paymentMethod === 'balance' &&
      draft.context.customer.balance < draft.pricing.paidAmountFen
    ) {
      throw new BadRequestException(
        clubVoucherError(
          CLUB_VOUCHER_ERROR_CODE.RULE_BALANCE_INSUFFICIENT,
          `余额不足，当前余额 ¥${Money.fromDbCents(draft.context.customer.balance).toFixedOutputYuan()}，需支付 ¥${Money.fromDbCents(draft.pricing.paidAmountFen).toFixedOutputYuan()}`,
        ),
      );
    }

    const skipWechatPrepay =
      draft.paymentMethod === 'wechat' &&
      (await this.clubPaymentModeService.isManualConfirmPaidAllowed());
    if (draft.paymentMethod !== 'wechat' || skipWechatPrepay) {
      return undefined;
    }

    // 微信 JSAPI 真实下单：openid 显式传入优先，未传则按 userId 回查。
    // 解析不到时不调起真实支付，保持既有降级口径。
    const wechatOpenid = await this.clubWechatOpenidService.resolveOpenid(
      currentContext.user.id,
      dto.openid,
    );
    if (!wechatOpenid) {
      return undefined;
    }

    return this.clubWechatJsapiService.createJsapiPaymentParams({
      storeId: draft.context.store.id,
      orderNo: draft.orderNo,
      description: `购买${draft.context.product.name}`,
      amountFen: draft.pricing.paidAmountFen,
      openid: wechatOpenid,
    });
  }

  /**
   * 顾客信息快照解析：
   * - 姓名：昵称非空用昵称；否则按手机号/标识派生展示名「纯利会员+后4位」，
   *   与加入门店时营销顾客档案的命名规则（buildClubMemberDisplayName）完全一致，
   *   避免静默微信注册用户（无昵称）的订单在商家端显示占位「顾客」、开台回填无名字。
   * - 电话：仅快照真实手机号；占位手机号（club_wechat:openid）不留存为空。
   */
  private resolveGuestSnapshot(user: {
    name?: string | null;
    phone?: string | null;
  }): { guestName: string | null; guestPhone: string | null } {
    const phone = user.phone ?? '';
    return {
      guestName: buildClubMemberDisplayName(phone, user.name),
      guestPhone: getDisplayPhone(phone) || null,
    };
  }
}
