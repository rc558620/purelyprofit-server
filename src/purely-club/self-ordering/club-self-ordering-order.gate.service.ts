// 自助下单门禁：业态 / 会话归属 / 会员时效 / 新客额度
//
// 从 ClubSelfOrderingOrderService 拆出的原因：四道门禁是「这一单允不允许下」的
// 政策判断，与建单事务的编排无关；额度口径（预检 + 事务内扣减）必须集中在一处，
// 避免建单流程里出现散落的政策分支。
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { MembershipDowngradeService } from '../../purely-profit/member/platform-membership/membership-downgrade.service';
import { SELF_ORDER_BLOCKED_MESSAGE } from '../../purely-profit/member/platform-membership/membership-downgrade.messages';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import {
  CLUB_SELF_ORDERING_ERROR_CODE,
  clubSelfOrderingError,
} from './club-self-ordering.errors';
import { assertGeneralStoreForSelfOrdering } from './club-self-ordering.utils';
import type { CreateSelfOrderDto } from './dto/create-self-order.dto';
import type { SelfOrderTarget } from './club-self-ordering-order.types';

@Injectable()
export class ClubSelfOrderingGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
    private readonly downgradeService: MembershipDowngradeService,
    private readonly quotaService: ClubNewCustomerQuotaService,
  ) {}

  /**
   * 四道门禁：业态 / 会话归属 / 会员时效 / 新客额度。
   *
   * 会话必须 active 且属于当前门店：杜绝把订单挂到别家门店或已结账的会话。
   * 新客额度闸门与扫码点餐同一口径：额度归属取本次下单所在门店——这位顾客若是新客，
   * 为其认证手机号的成本就由这家门店承担；他若已在别家店认证过，
   * 则不再扣额度、也不受本店额度是否为 0 影响。
   */
  async resolveOrderTarget(
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

  /**
   * 事务内扣减新客额度。
   *
   * 扣不到额度（并发下被别人抢走最后一个）直接抛错，让整笔建单回滚，
   * 保证「服务的新客数」严格等于「扣掉的额度」；老客在此直接放行。
   */
  async consumeNewCustomerQuota(
    tx: Prisma.TransactionClient,
    target: SelfOrderTarget,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.quotaService.consumeWithinOrderTransaction(
      tx,
      target.storeId,
      user.id,
      user.phone || null,
    );
  }
}
