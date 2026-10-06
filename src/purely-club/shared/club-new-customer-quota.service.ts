// C 端建单链路共用的额度记账：建单前闸门 + 建单成功后扣减
//
// 扫码点餐之外的自助下单 / 团购券 / 服务商品三条链路同样在消耗「新客额度」，
// 闸门与扣减的语义必须与扫码点餐完全一致，否则新客可以换一条链路绕过额度。
//
// 「新客」是**全局口径**：手机号认证（微信 getPhoneNumber）一位顾客只需一次，
// 已在任意门店认证过的顾客换到别家店不再验证、不再扣额度。
// 因此额度由第一家服务该顾客的门店承担——即本次下单所在门店（若他是新客）。
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { NewCustomerQuotaService } from '../../purely-profit/member/new-customer-quota/new-customer-quota.service';
import type { ConsumeNewCustomerQuotaResult } from '../../purely-profit/member/new-customer-quota/new-customer-quota.types';

@Injectable()
export class ClubNewCustomerQuotaService {
  constructor(private readonly quotaService: NewCustomerQuotaService) {}

  /**
   * 建单前闸门：新客（任意门店都未消耗过额度）在额度耗尽时禁止下单，
   * 商家充值后才能继续。
   *
   * 刻意放在定价之前——被拦时不必白算一轮价格与促销。
   * 老客（已在任意门店消耗过额度）换店也不受限制，见
   * `ensureAvailableForNewCustomer`。
   */
  assertAvailableForOrder(
    storeId: number,
    clubUserId: number,
  ): Promise<boolean> {
    return this.quotaService.ensureAvailableForNewCustomer(storeId, clubUserId);
  }

  /**
   * 在**建单事务内**扣减新客额度：必须在订单落库之后、事务提交之前调用。
   *
   * 刻意不吞异常：扣不到额度（并发下被别人抢走最后一个）就让整个建单事务回滚，
   * 保证「服务的新客数」严格等于「扣掉的额度」——不多也不少。
   *
   * 老客由 `consumeForNewCustomer` 按 clubUserId **全局**识别后直接放行，
   * 不会走到扣减，所以这里抛错只会发生在「新客 + 额度真的没了」这一唯一场景。
   */
  consumeWithinOrderTransaction(
    tx: Prisma.TransactionClient,
    storeId: number,
    clubUserId: number,
    phone: string | null,
  ): Promise<ConsumeNewCustomerQuotaResult> {
    return this.quotaService.consumeForNewCustomer(
      storeId,
      clubUserId,
      phone,
      tx,
    );
  }

  /**
   * 独立事务扣减（不并入建单事务），同样**不吞异常**。
   *
   * 仅供订单不落数据库、只能用补偿方式保证一致性的链路使用（服务商品草稿只存
   * Redis）：调用方必须在扣减失败时撤销已创建的订单，否则就退化成白嫖。
   */
  consumeForOrder(
    storeId: number,
    clubUserId: number,
    phone: string | null,
  ): Promise<ConsumeNewCustomerQuotaResult> {
    return this.quotaService.consumeForNewCustomer(storeId, clubUserId, phone);
  }
}
