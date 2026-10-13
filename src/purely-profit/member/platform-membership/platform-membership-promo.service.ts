import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  TX_TIMEOUT_SHORT,
} from '../../../prisma/prisma.service';
import { getShanghaiMonthStartMs } from '../../../shared/shanghai-time.utils';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { PROMO_BEAN_REWARDS_BY_LEVEL } from './platform-membership.constants';
import type { PartnerLevelValue } from './platform-membership.types';
import { buildPhoneLoginEmail } from '../../auth/auth.utils';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import { resolvePartnerLevel } from './platform-membership-promo-stats.domain';
import { PlatformMembershipPromoBeanReconciliationService } from './platform-membership-promo-bean-reconciliation.service';

@Injectable()
export class PlatformMembershipPromoService {
  private readonly logger = new Logger(PlatformMembershipPromoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly beanReconciliationService: PlatformMembershipPromoBeanReconciliationService,
  ) {}

  /**
   * 服务启动时修复历史未充值推广记录。
   * 查找所有 hasCharged=false 的记录，检查被推广人是否已充值，
   * 如果已充值则补发推广奖励。
   */
  async backfillUnchargedPromoRecords(): Promise<void> {
    // 先清理历史重复豆日志并校正余额。
    // 内部带分布式锁：多实例部署时只有一个实例执行，避免并发重算覆盖余额
    await this.beanReconciliationService.runStartupReconciliation();

    const uncharged = await this.prisma.storeMembershipPromoRecord.findMany({
      where: { hasCharged: false },
      select: {
        id: true,
        inviteePhone: true,
        storeId: true,
        partnerId: true,
        registeredAt: true,
      },
    });

    if (uncharged.length === 0) return;
    this.logger.log(
      `发现 ${uncharged.length} 条未充值推广记录，开始检查修复...`,
    );

    let fixedCount = 0;
    const affectedStoreIds = new Set<number>();

    for (const record of uncharged) {
      this.logger.log(
        `[backfill] 处理记录 #${record.id}: inviteePhone=${record.inviteePhone}, storeId=${record.storeId}`,
      );

      // 通过 User.email 查找被推广人的门店
      // User.email 格式: profit_phone_{phone}@purelyprofit.local
      const inviteeEmail = buildPhoneLoginEmail(
        'purely_profit',
        record.inviteePhone,
      );
      const inviteeUser = await this.prisma.user.findUnique({
        where: { email: inviteeEmail },
        select: { id: true },
      });
      if (!inviteeUser) {
        this.logger.log(
          `[backfill] 记录 #${record.id}: 未找到 User (email=${inviteeEmail})，跳过`,
        );
        continue;
      }

      // 查找被推广人拥有的门店
      const inviteeStore = await this.prisma.store.findFirst({
        where: { ownerId: inviteeUser.id },
        select: { id: true },
      });
      if (!inviteeStore) {
        this.logger.log(
          `[backfill] 记录 #${record.id}: 用户 ${inviteeUser.id} 无门店，跳过`,
        );
        continue;
      }

      // 检查被推广人门店是否有 paid 订单。
      // 只看真实微信充值：管理端「设置会员等级」写的后台订单（admin / gift）
      // 不是被推广人自己付费，不能作为触发推广返豆的依据
      const paidOrder = await this.prisma.storeMembershipOrder.findFirst({
        where: {
          storeId: inviteeStore.id,
          status: 'paid',
          paymentChannel: 'wechat',
        },
        select: { amount: true, planId: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!paidOrder) {
        this.logger.log(
          `[backfill] 记录 #${record.id}: 门店 ${inviteeStore.id} 无 paid 订单，跳过`,
        );
        continue;
      }
      this.logger.log(
        `[backfill] 记录 #${record.id}: 找到 paid 订单 (planId=${paidOrder.planId}, amount=${paidOrder.amount})`,
      );

      // 有 paid 订单但未触发推广奖励 → 补发
      const planId = paidOrder.planId as PlatformMembershipPlanId;

      // 查找推广人
      let partnerId = record.partnerId;
      if (!partnerId) {
        const partner = await this.prisma.storePartner.findFirst({
          where: { storeId: record.storeId, status: 'approved' },
          select: { id: true },
          orderBy: { joinedAt: 'asc' },
        });
        if (!partner) continue;
        partnerId = partner.id;
      }

      // 计算合伙人等级（自然月按上海时区切分，避免跨月瞬间等级判错）
      const monthStart = new Date(getShanghaiMonthStartMs(Date.now()));
      const monthChargedCount =
        await this.prisma.storeMembershipPromoRecord.count({
          where: {
            partnerId,
            hasCharged: true,
            chargedAt: { gte: monthStart },
          },
        });
      const partnerLevel: PartnerLevelValue =
        this.resolveRewardLevel(monthChargedCount);
      const rewardBeans =
        PROMO_BEAN_REWARDS_BY_LEVEL[partnerLevel]?.[
          planId as keyof (typeof PROMO_BEAN_REWARDS_BY_LEVEL)['star']
        ] ?? 0;

      // 去重：检查是否已为该记录发放过豆子（只读校验，可在事务外）
      const existingLog =
        rewardBeans > 0
          ? await this.prisma.storePartnerBeanLog.findFirst({
              where: {
                relatedPromoRecordId: record.id,
                source: 'promo_reward',
              },
              select: { id: true },
            })
          : null;

      // 置位 + 发豆 + 写日志放进同一事务，与主流程 tryAwardPromoReward 口径一致。
      // 关键：若置位在事务外、发豆在事务内，一旦发豆失败记录已 hasCharged=true，
      // 下轮 backfill 的 findMany(hasCharged=false) 再也查不到它 —— 奖励永久丢失。
      // 合并后要么全成功，要么整体回滚，下轮可安全重试。
      const outcome = await this.prisma
        .$transaction(
          async (tx) => {
            // 原子更新推广记录（hasCharged=false 作为并发锁）
            const updateResult = await tx.storeMembershipPromoRecord.updateMany(
              {
                where: { id: record.id, hasCharged: false },
                data: {
                  hasCharged: true,
                  chargedAmount: paidOrder.amount,
                  chargedAt: new Date(),
                  chargedPlan: planId,
                  rewardBeans,
                  ...(record.partnerId === null ? { partnerId } : {}),
                },
              },
            );
            // 已被其他进程处理，跳过豆子发放
            if (updateResult.count === 0) return 'skipped' as const;

            if (rewardBeans > 0 && !existingLog) {
              await tx.storePartner.update({
                where: { id: partnerId },
                data: {
                  beanBalance: { increment: rewardBeans },
                  totalEarnedBeans: { increment: rewardBeans },
                },
              });

              await tx.storePartnerBeanLog.create({
                data: {
                  storeId: record.storeId,
                  partnerId,
                  source: 'promo_reward',
                  changeAmount: rewardBeans,
                  description: `推广奖励(补发) · ${planId}套餐`,
                  relatedPromoRecordId: record.id,
                  relatedPlanType: planId,
                  relatedUser: record.inviteePhone.replace(
                    /(\d{3})\d{4}(\d{4})/,
                    '$1****$2',
                  ),
                },
              });
            }
            return 'done' as const;
          },
          { timeout: TX_TIMEOUT_SHORT },
        )
        .catch((err: unknown) => {
          // 事务已整体回滚（未置位），下轮启动会再次进入 backfill 重试
          this.logger.error(
            `[backfill] 记录 #${record.id}: 补发事务失败，等待下轮补偿: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return 'failed' as const;
        });

      if (outcome === 'skipped') {
        this.logger.log(
          `[backfill] 记录 #${record.id}: 已被其他进程处理，跳过`,
        );
        continue;
      }
      if (outcome === 'failed') continue;

      if (existingLog) {
        this.logger.log(
          `[backfill] 记录 #${record.id}: 已存在豆日志 #${existingLog.id}，仅补置位`,
        );
      }

      affectedStoreIds.add(record.storeId);
      fixedCount++;
      this.logger.log(
        `已修复推广记录 #${record.id}: partnerId=${partnerId}, beans=${rewardBeans}`,
      );
    }

    // 清除受影响门店的缓存
    for (const storeId of affectedStoreIds) {
      await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);
    }

    if (fixedCount > 0) {
      this.logger.log(`历史推广记录修复完成: 共修复 ${fixedCount} 条`);
    }
  }

  /**
   * 充值时尝试发放推广奖励。
   * 流程：查询用户手机号 → 匹配未充值推广记录 → 计算纯利豆 → 更新记录 + 发放豆子。
   * 幂等保护：hasCharged 标记为 true 后不会再被查出，避免重复发放。
   */
  async tryAwardPromoReward(input: {
    userId: number;
    storeId: number;
    planId: PlatformMembershipPlanId;
    amount: number;
  }): Promise<void> {
    // 1. 通过 User.email 提取当前用户的手机号
    //    User.email 格式: profit_phone_{phone}@purelyprofit.local
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, wechatPhone: true },
    });
    if (!user) return;
    // 优先从登录邮箱反解手机号，其次使用微信授权手机号（邮箱被改写时仍能兜底）
    const phoneMatch = user.email.match(
      /^profit_phone_(.+)@purelyprofit\.local$/,
    );
    const inviteePhone = phoneMatch?.[1] ?? user.wechatPhone ?? null;
    if (!inviteePhone) {
      this.logger.warn(
        `无法解析用户 ${input.userId} 的手机号，跳过推广奖励发放`,
      );
      return;
    }

    // 2. 查找该用户手机号关联的未充值推广记录
    //    hasCharged=false 作为幂等保护：已处理的记录不会被重复查出
    //
    //    只取最早注册的一条：同一手机号若因历史数据 / 多推广人录入存在多条记录，
    //    全量遍历会让一次充值给多个推广人都发豆（一单多发）。
    //    归属权以最早建立推广关系的记录为准。
    const unchargedPromos =
      await this.prisma.storeMembershipPromoRecord.findMany({
        where: {
          inviteePhone,
          hasCharged: false,
        },
        select: {
          id: true,
          storeId: true,
          partnerId: true,
        },
        orderBy: { registeredAt: 'asc' },
        take: 1,
      });
    if (unchargedPromos.length === 0) return;

    const now = new Date();
    /** 本次实际发放奖励的门店，用于定向失效缓存 */
    const awardedStoreIds = new Set<number>();

    for (const promo of unchargedPromos) {
      // 3. 查找推广记录所属门店的已通过合伙人
      let partnerId = promo.partnerId;
      if (!partnerId) {
        const partner = await this.prisma.storePartner.findFirst({
          where: { storeId: promo.storeId, status: 'approved' },
          select: { id: true },
          orderBy: { joinedAt: 'asc' },
        });
        if (!partner) {
          this.logger.debug(
            `推广记录 #${promo.id} 所属门店 ${promo.storeId} 无已通过合伙人，跳过奖励`,
          );
          continue;
        }
        partnerId = partner.id;
      }

      // 4. 查询合伙人当前等级（通过本月已充值推广人数计算，按上海时区切月）
      const monthStart = new Date(getShanghaiMonthStartMs(Date.now()));
      const monthChargedCount =
        await this.prisma.storeMembershipPromoRecord.count({
          where: {
            partnerId,
            hasCharged: true,
            chargedAt: { gte: monthStart },
          },
        });

      const partnerLevel: PartnerLevelValue =
        this.resolveRewardLevel(monthChargedCount);

      // 5. 计算奖励纯利豆数
      const rewardBeans =
        PROMO_BEAN_REWARDS_BY_LEVEL[partnerLevel]?.[
          input.planId as keyof (typeof PROMO_BEAN_REWARDS_BY_LEVEL)['star']
        ] ?? 0;

      // 6~8. 置位 + 发豆 + 写日志放在同一事务，避免置位后崩溃导致奖励丢失
      const awarded = await this.prisma
        .$transaction(
          async (tx) => {
            // 原子更新推广记录（hasCharged=false 作为并发锁）
            const updateResult = await tx.storeMembershipPromoRecord.updateMany(
              {
                where: { id: promo.id, hasCharged: false },
                data: {
                  hasCharged: true,
                  chargedAmount: input.amount,
                  chargedAt: now,
                  chargedPlan: input.planId,
                  rewardBeans,
                  // 如果之前 partnerId 为 null，补绑
                  ...(promo.partnerId === null ? { partnerId } : {}),
                },
              },
            );
            // 如果已被其他进程处理，跳过豆子发放
            if (updateResult.count === 0) return false;

            if (rewardBeans > 0) {
              // 发放纯利豆给推广人
              await tx.storePartner.update({
                where: { id: partnerId },
                data: {
                  beanBalance: { increment: rewardBeans },
                  totalEarnedBeans: { increment: rewardBeans },
                },
              });

              // 写入纯利豆日志
              await tx.storePartnerBeanLog.create({
                data: {
                  storeId: promo.storeId,
                  partnerId,
                  source: 'promo_reward',
                  changeAmount: rewardBeans,
                  description: `推广奖励 · ${input.planId}套餐`,
                  relatedPromoRecordId: promo.id,
                  relatedPlanType: input.planId,
                  relatedUser: inviteePhone.replace(
                    /(\d{3})\d{4}(\d{4})/,
                    '$1****$2',
                  ),
                },
              });
            }
            return true;
          },
          { timeout: TX_TIMEOUT_SHORT },
        )
        .catch((err: unknown) => {
          // 事务失败时不标记 charged，后续可由启动补偿重新发放
          this.logger.error(
            `推广奖励发放事务失败（未标记已发放，等待补偿）: promoId=${promo.id}, error=${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return false;
        });

      if (!awarded) continue;

      awardedStoreIds.add(promo.storeId);

      this.logger.log(
        `推广奖励已发放: partnerId=${partnerId}, rewardBeans=${rewardBeans}, promoId=${promo.id}`,
      );
    }

    // 9. 清除推广人缓存以刷新统计数据（仅失效本次实际发放的门店）
    for (const storeId of awardedStoreIds) {
      await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);
    }
  }

  /**
   * 计算「本次成交」应适用的合伙人等级。
   *
   * monthChargedCount 统计的是**已置位**的记录，而本单此刻尚未置位，
   * 因此它代表「本单之前」的成交人数，需 +1 才是含本单的人数。
   *
   * 这样才与展示侧 buildPartnerLevel 对齐（展示时本单已 hasCharged=true，
   * 天然含本单）。否则会出现：本月第 10 单按 star(8豆) 发，
   * 用户刷新后却看到自己是 elite(9豆) 的口径不一致问题。
   */
  private resolveRewardLevel(monthChargedCount: number): PartnerLevelValue {
    return resolvePartnerLevel(monthChargedCount + 1);
  }
}
