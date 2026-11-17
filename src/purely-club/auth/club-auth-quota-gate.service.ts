import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { NewCustomerQuotaService } from '../../purely-profit/member/new-customer-quota/new-customer-quota.service';
import type { NewCustomerQuotaCheckResult } from '../../purely-profit/member/new-customer-quota/new-customer-quota.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';

/**
 * C 端「新客额度」闸门。
 *
 * 从 `ClubAuthService` 抽离，因为它同时服务三条链路（登录后补绑、微信一键绑定、
 * 额度状态查询），职责是「定位额度归属门店 + 预检 + 幂等扣减」，与认证编排无关。
 *
 * 语义关键点：
 * - 新客是**全局口径**：手机号认证一位顾客只需一次，任意门店消耗过额度的顾客
 *   换到哪家店都不该被额度拦住；
 * - 优先用扫码会话所属门店，而不是「当前选中门店」。
 */
@Injectable()
export class ClubAuthQuotaGateService {
  private readonly logger = new Logger(ClubAuthQuotaGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: NewCustomerQuotaService,
    private readonly clubCurrentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  /**
   * 额度状态：告知前端「当前顾客是否新客」以及「额度是否阻止其下单」。
   *
   * blocked **只对新客为真**。
   *
   * @param sessionId 扫码点餐会话 ID。传了就以会话所属门店为准——
   *   「当前选中门店」与「扫码进的那家店」是两回事，用错会把额度算到别的门店。
   */
  async getStatus(
    user: AuthenticatedUser,
    sessionId?: number | null,
  ): Promise<NewCustomerQuotaCheckResult> {
    const storeId = sessionId
      ? await this.resolveStoreIdBySessionId(sessionId, user.id)
      : await this.resolveQuotaStoreId(user);
    if (storeId === null) {
      return { isNewCustomer: false, blocked: false, remaining: 0 };
    }

    const isNewCustomer = await this.quotaService.isNewCustomer(user.id);
    const overview = await this.quotaService.getOverview(storeId);
    return {
      isNewCustomer,
      blocked: isNewCustomer && overview.remaining <= 0,
      remaining: overview.remaining,
    };
  }

  /**
   * 绑定完成后解析**最终**账号 ID。
   *
   * 手机号若已属于另一个账号，绑定实现会把当前微信账号**合并**到那个账号上并为其
   * 签发 token —— 此后所有请求携带的都是目标账号 ID。额度留痕若按绑定前的 ID
   * 记账，合并后的账号永远查不到它，下次下单 / 换店又会被判成新客再扣一次额度。
   *
   * `users.wechat_phone` 唯一，绑定完成后它就是最终账号的标识；查不到（理论上
   * 不该发生）时回退到调用方传入的 ID，不阻断绑定主流程。
   */
  async resolveBoundUserId(
    phone: string,
    fallbackUserId: number,
  ): Promise<number> {
    try {
      const boundUser = await this.prisma.user.findFirst({
        where: { wechatPhone: phone },
        select: { id: true },
      });
      return boundUser?.id ?? fallbackUserId;
    } catch (error) {
      this.logger.warn(
        `绑定后解析账号 ID 失败，回退到 ${fallbackUserId}：${String(error)}`,
      );
      return fallbackUserId;
    }
  }

  /**
   * 绑定前的额度闸门：两条绑定链路（短信 / 微信 getPhoneNumber）共用。
   *
   * 仅对尚未消耗过额度的顾客生效：老顾客换设备 / 重新绑定 / 换店都不该被
   * 额度拦住，更不该被要求再验证一次手机号。
   *
   * @returns 额度归属门店，供绑定成功后扣减复用；null 表示定位不到门店，
   *   按「不拦截也不扣减」处理（绑定本身是账号级操作，不能因为额度查不到就拒绝）
   */
  async assertAvailableForBind(
    currentUser?: AuthenticatedUser,
    sessionId?: number | null,
  ): Promise<number | null> {
    if (currentUser === undefined) return null;

    const storeId = await this.resolveQuotaStoreId(currentUser, sessionId);
    if (storeId === null) return null;

    await this.quotaService.ensureAvailableForNewCustomer(
      storeId,
      currentUser.id,
    );
    return storeId;
  }

  /**
   * 新客扣减：由 `consumeForNewCustomer` 按 clubUserId 保证幂等，
   * 老顾客重复绑定 / 重复下单 / 换店都不会重复扣；额度意外耗尽时只记日志，
   * 不阻断主流程。
   */
  async consumeForNewCustomer(
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<void> {
    try {
      await this.quotaService.consumeForNewCustomer(storeId, clubUserId, phone);
    } catch (error) {
      this.logger.warn(
        `新用户额度扣减失败，store ${storeId} user ${clubUserId}：${String(error)}`,
      );
    }
  }

  /**
   * 由扫码点餐会话解析门店：会话与 clubUserId 绑定，取到的 storeId 就是
   * 用户扫码进的那家店，不受「当前选中门店」影响。
   *
   * 会话不存在 / 不属于该用户 / 已结束 → 返回 null，按「不拦截」处理。
   */
  private async resolveStoreIdBySessionId(
    sessionId: number,
    clubUserId: number,
  ): Promise<number | null> {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: sessionId,
        clubUserId,
        status: 'active',
        deletedAt: null,
      },
      select: { storeId: true },
    });
    return session?.storeId ?? null;
  }

  /**
   * 解析额度归属门店。
   *
   * `@param sessionId` 优先：用户可能是在扫码点餐流程中被引导来绑手机的，
   * 此时「当前选中门店」与「扫码进的那家店」是两回事，必须用后者，否则额度
   * 会记到别的门店头上。缺省（从个人中心进入绑定页等）时才退回「当前选中门店」。
   * 两者都取不到（未加入任何门店）时不拦截也不扣减，返回 null。
   */
  private async resolveQuotaStoreId(
    user: AuthenticatedUser,
    sessionId?: number | null,
  ): Promise<number | null> {
    if (sessionId !== null && sessionId !== undefined && sessionId > 0) {
      return this.resolveStoreIdBySessionId(sessionId, user.id);
    }

    try {
      const store =
        await this.clubCurrentStoreContextService.getCurrentStore(user);
      return store.id ?? null;
    } catch {
      return null;
    }
  }
}
