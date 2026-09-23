import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { NewCustomerQuotaService } from '../../purely-profit/member/new-customer-quota/new-customer-quota.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import type { PulseAdminStatusMutationInput } from './membership.types';

/**
 * 会员状态（封禁 / 解封 / 注销）写服务。
 *
 * 只负责「状态语义」本身：封禁原因落库、软删除门店、注销后释放登录身份，
 * 以及写操作后的缓存与会话失效；鉴权与详情重建由上层编排服务负责。
 */
@Injectable()
export class PulseMembershipAdminStatusMutationService {
  private readonly logger = new Logger(
    PulseMembershipAdminStatusMutationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
    private readonly quotaService: NewCustomerQuotaService,
  ) {}

  async banAdminMember(
    memberId: number,
    dto: PulseAdminStatusMutationInput,
  ): Promise<void> {
    const reason = this.resolveBanReason(dto);
    await this.touchStore(memberId);

    await this.accessService.writeAdminMemberBanReason(memberId, reason);
    await this.mutationStateService.invalidateAdminMemberDerived(memberId);
  }

  async unbanAdminMember(memberId: number): Promise<void> {
    await this.touchStore(memberId);

    await this.accessService.clearAdminMemberBanReason(memberId);
    await this.mutationStateService.invalidateAdminMemberDerived(memberId);
  }

  async cancelAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<void> {
    const now = new Date();

    this.logger.warn(
      JSON.stringify({
        event: 'pulse_admin_member_cancel',
        memberId,
        operatorUserId: user.id,
        operatorEmail: user.email,
        cancelledAt: now.toISOString(),
      }),
    );

    // 软删除：设置 deletedAt 以标记注销状态
    await this.prisma.store.update({
      where: { id: memberId },
      data: {
        deletedAt: now,
        updatedAt: now,
      },
    });

    // 释放登录身份：注销后该手机号视同从未注册，允许重新完整注册
    await this.releaseOwnerLoginIdentity(memberId);

    // 新用户额度：注销账号即清零
    await this.quotaService.clear(memberId, '注销账号，新用户额度清零');

    // 清除封禁原因（注销后封禁信息不再有意义）
    await this.accessService.clearAdminMemberBanReason(memberId);
    // 踢出所有用户 token 并失效相关缓存
    await this.mutationStateService.invalidateAdminMemberDerived(memberId);
  }

  /** 写入状态变更时间戳，让门店行的 updatedAt 反映本次管理员操作 */
  private touchStore(memberId: number): Promise<unknown> {
    return this.prisma.store.update({
      where: { id: memberId },
      data: {
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 注销后释放 owner 的登录身份，让手机号可以重新注册：
   * - 门店员工行停用，并改写 email/phone/login_account：
   *   数据库有「单账号单门店」唯一索引（staffs_email_key 等）与触发器
   *   （ensure_single_store_binding_for_store_owner），它们不感知软删除，
   *   已注销门店的员工行若仍占用手机号派生邮箱，会阻断同手机号重新注册建店
   * - owner 无其他在营门店时，改写其唯一登录邮箱（手机号派生）并解绑微信手机号，
   *   释放 users 表唯一约束，使「手机号已被注册」不再拦截重新注册
   */
  private async releaseOwnerLoginIdentity(memberId: number): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: memberId },
      select: { ownerId: true },
    });
    if (!store) {
      return;
    }

    // 释放该门店全部员工行的登录身份（幂等：已改写为 cancelled_ 前缀的行跳过）
    await this.prisma.$executeRaw`
      UPDATE "staffs"
         SET is_active = false,
             email = 'cancelled_s'
                     || store_id::text || '_st' || id::text
                     || '_' || ${String(Date.now())} || '@purelyprofit.invalid',
             phone = NULL,
             login_account = NULL
       WHERE store_id = ${memberId}
         AND email NOT LIKE 'cancelled\_%'
    `;

    // owner 还拥有其他在营门店时，不能动其用户身份
    const activeOwnedStoreCount = await this.prisma.store.count({
      where: { ownerId: store.ownerId, deletedAt: null, id: { not: memberId } },
    });
    if (activeOwnedStoreCount > 0) {
      return;
    }

    await this.prisma.user.update({
      where: { id: store.ownerId },
      data: {
        // 改写为不占手机号语义的唯一邮箱，释放 phone_xxx@... 派生登录邮箱
        email: `cancelled_u${store.ownerId}_${Date.now()}@purelyprofit.invalid`,
        // 解绑微信授权手机号，允许该手机号重新注册/绑定
        wechatPhone: null,
      },
    });
  }

  private resolveBanReason(dto: PulseAdminStatusMutationInput): string {
    const reason = dto.reason?.trim() ?? dto.remark?.trim() ?? '';
    if (!reason) {
      throw new BadRequestException('缺少封禁原因');
    }

    return reason;
  }
}
