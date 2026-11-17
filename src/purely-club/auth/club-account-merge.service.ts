import { CLUB_AUTH_ERROR_CODE, clubAuthError } from './club-auth.errors';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuthLegacyOwnerRepairService } from '../../purely-profit/auth/auth-legacy-owner-repair.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { PrismaService, TX_TIMEOUT_LONG } from '../../prisma/prisma.service';
import {
  mergeCustomerProfiles,
  mergeMemberProfiles,
  resolveSourceMembership,
} from './club-account-merge.membership';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';

/** 合并时的源账号（微信账号）信息 */
export interface ClubMergeSourceUser {
  wechatOpenid: string | null;
  wechatUnionid: string | null;
  wechatNickname: string | null;
  wechatAvatar: string | null;
  /** 源用户当前已绑定的手机号（可能已是真实号码，而非占位值） */
  wechatPhone: string | null;
}

/**
 * 账号合并：把微信账号（源）的 openid、会员档案、门店归属合到手机号账号（目标）。
 *
 * 从 ClubAuthService 抽离，因为它是「绑定手机号」的一个分支（手机号已有账号时），
 * 换绑路径完全用不到它。
 *
 * 档案定位与资产迁移的细节见 `club-account-merge.membership.ts`，本类只负责
 * 事务编排与事务外副作用（缓存失效、登录态失效、签发 token）。
 */
@Injectable()
export class ClubAccountMergeService {
  private readonly logger = new Logger(ClubAccountMergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authSessionService: AuthSessionService,
    private readonly legacyOwnerRepairService: AuthLegacyOwnerRepairService,
  ) {}

  /**
   * 事务性合并：将微信用户的 openid、Member 记录和 Store ownership 迁移到手机号账号
   *
   * 合并步骤（全部在同一个数据库事务中）：
   * 1. 迁移源用户（微信账号）在各门店的 Member / MarketingCustomer 档案到目标用户
   * 2. 迁移源用户的 Store ownership（ownerId）到目标用户
   * 3. 迁移源用户的新客额度消耗留痕（clubUserId）到目标用户
   * 4. 将 openid 从源用户移到目标用户，清除源用户的微信相关字段
   *
   * 事务失败时整体回滚，不会出现中间状态。
   *
   * ⚠️ 定位源档案时**不要假设 `phone` 还是占位值**：用户可能先绑过一个手机号（那时
   * `migrateWechatPlaceholderPhone` 已把它迁成真实号码），之后才绑到另一个已有账号上
   * 触发合并。只认占位值会一条都找不到 —— openid 合过去了，会员档案、储值余额、积分、
   * 纯利豆全留在源账号上，用户在新账号里看不到自己的资产（见 03 文档第 6 节 P0）。
   */
  async mergeWechatUserToPhoneUser(
    sourceUserId: number,
    targetUserId: number,
    phone: string,
    sourceUser: ClubMergeSourceUser,
  ): Promise<AuthTokenResponseDto> {
    if (!sourceUser.wechatOpenid) {
      throw new ConflictException(
        clubAuthError(
          CLUB_AUTH_ERROR_CODE.RULE_MERGE_OPENID_MISSING,
          '当前微信账号缺少 openid，无法完成合并，请联系客服',
        ),
      );
    }

    // 取局部常量：闭包内 TS 不会保留对 sourceUser 字段的收窄
    const sourceOpenid = sourceUser.wechatOpenid;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // 软删除时间戳：整批共用一个值，避免同一事务里出现多个删除时刻
          const mergedAt = new Date();
          // 1. 迁移会员档案（Member + MarketingCustomer）
          //    定位方式见 resolveSourceMembership —— 不再假设 phone 还是占位值
          const { members, customers } = await resolveSourceMembership(
            tx,
            sourceUserId,
            sourceOpenid,
            sourceUser.wechatPhone,
          );
          await mergeMemberProfiles(tx, this.logger, members, phone, mergedAt);
          await mergeCustomerProfiles(
            tx,
            this.logger,
            customers,
            targetUserId,
            phone,
            mergedAt,
          );

          // 2. 迁移 Store ownership
          await this.migrateStoreOwnership(tx, sourceUserId, targetUserId);

          // 3. 迁移新客额度消耗留痕
          await this.migrateQuotaConsumeRecords(tx, sourceUserId, targetUserId);

          // 4. 迁走 openid 并清除源账号微信字段
          await this.rebindWechatIdentity(
            tx,
            sourceUserId,
            targetUserId,
            phone,
            sourceUser,
          );
        },
        { timeout: TX_TIMEOUT_LONG },
      );
    } catch (error) {
      this.logger.error(
        `bindPhone 合并事务失败：sourceUserId=${sourceUserId}, targetUserId=${targetUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ConflictException(
        clubAuthError(
          CLUB_AUTH_ERROR_CODE.DEPENDENCY_MERGE_TRANSACTION_FAILED,
          '账号合并失败，请重试或联系客服',
        ),
      );
    }

    await this.invalidateMergedAccountCaches(sourceUserId, targetUserId);

    return this.issueMergedAccountToken(targetUserId, phone);
  }

  /**
   * 迁移 Store ownership（源用户拥有的门店转移到目标用户）。
   */
  private async migrateStoreOwnership(
    tx: Prisma.TransactionClient,
    sourceUserId: number,
    targetUserId: number,
  ): Promise<void> {
    const ownedStores = await tx.store.findMany({
      where: { ownerId: sourceUserId, deletedAt: null },
      select: { id: true },
    });

    if (ownedStores.length === 0) return;

    await tx.store.updateMany({
      where: { ownerId: sourceUserId },
      data: { ownerId: targetUserId },
    });
    this.logger.log(
      `bindPhone 合并 Store ownership：将 ${ownedStores.length} 个门店从用户 ${sourceUserId} 转移到用户 ${targetUserId}`,
    );
  }

  /**
   * 迁移新客额度消耗留痕。
   *
   * `store_new_customer_quota_consumes.club_user_id` 是**全局唯一**的，且合并后
   * 签发的 token 属于目标用户 —— 留痕若留在源账号上，目标账号永远查不到它，
   * 下次下单 / 换店会被判成新客再扣一次额度（等于「换一家店又验证一次手机号」，
   * 正是要消除的行为）。
   */
  private async migrateQuotaConsumeRecords(
    tx: Prisma.TransactionClient,
    sourceUserId: number,
    targetUserId: number,
  ): Promise<void> {
    const sourceConsume = await tx.storeNewCustomerQuotaConsume.findUnique({
      where: { clubUserId: sourceUserId },
      select: { id: true },
    });
    if (!sourceConsume) return;

    const targetConsume = await tx.storeNewCustomerQuotaConsume.findUnique({
      where: { clubUserId: targetUserId },
      select: { id: true },
    });

    if (targetConsume) {
      // 两端都消耗过：只保留目标那条。源记录对应的额度已由源门店承担，
      // 不做退款——顾客一生只该消耗一个额度，合并不能变成「退一个再扣一个」。
      await tx.storeNewCustomerQuotaConsume.delete({
        where: { id: sourceConsume.id },
      });
      this.logger.log(
        `bindPhone 合并新客额度留痕：目标用户 ${targetUserId} 已消耗过，删除源记录 ${sourceConsume.id}`,
      );
      return;
    }

    await tx.storeNewCustomerQuotaConsume.update({
      where: { id: sourceConsume.id },
      data: { clubUserId: targetUserId },
    });
    this.logger.log(
      `bindPhone 合并新客额度留痕：源记录 ${sourceConsume.id} 由用户 ${sourceUserId} 改挂到 ${targetUserId}`,
    );
  }

  /**
   * 把 openid 从源账号迁到目标账号。
   *
   * 必须先清空源账号的微信字段再写目标账号，否则 `wechat_openid` 的唯一约束
   * 会让写入目标用户时冲突。
   */
  private async rebindWechatIdentity(
    tx: Prisma.TransactionClient,
    sourceUserId: number,
    targetUserId: number,
    phone: string,
    sourceUser: ClubMergeSourceUser,
  ): Promise<void> {
    await tx.user.update({
      where: { id: sourceUserId },
      data: {
        wechatOpenid: null,
        wechatUnionid: null,
        wechatNickname: null,
        wechatAvatar: null,
        wechatPhone: null,
      },
    });

    await tx.user.update({
      where: { id: targetUserId },
      data: {
        wechatOpenid: sourceUser.wechatOpenid,
        ...(sourceUser.wechatUnionid != null && {
          wechatUnionid: sourceUser.wechatUnionid,
        }),
        ...(sourceUser.wechatNickname != null && {
          wechatNickname: sourceUser.wechatNickname,
        }),
        ...(sourceUser.wechatAvatar != null && {
          wechatAvatar: sourceUser.wechatAvatar,
        }),
        wechatPhone: phone,
      },
    });
  }

  /**
   * 事务提交后的缓存与登录态失效。
   *
   * - 门店 ownership 已迁到目标账号：必须清掉「该账号无 owner 门店」负缓存，
   *   否则目标账号在 TTL 窗口内不会被遗留店主补齐，进商家端看不到刚迁过来的门店。
   * - 失效两端的旧登录态，确保合并后旧 token 立即无效。`bumpTokenVersion` 只让旧
   *   access_token 立刻失效，而 refresh_token 在 Redis 里还有 30 天 TTL，客户端拿它
   *   照样能换出新 token —— 因此两步缺一不可。
   */
  private async invalidateMergedAccountCaches(
    sourceUserId: number,
    targetUserId: number,
  ): Promise<void> {
    await this.legacyOwnerRepairService.invalidateOwnerAbsentCache(
      targetUserId,
    );

    // 两步都必须严格早于 signToken：
    // - 晚于 signToken 的 bump，会让新 access_token 签发即失效；
    // - removeAllSessions 按 userId 删 Redis 里的 refresh_token，晚于 signToken
    //   执行会把刚签发的那份一并删除，用户从此再无法续期。
    await Promise.all([
      this.authSessionService.bumpTokenVersion(sourceUserId),
      this.authSessionService.bumpTokenVersion(targetUserId),
    ]);
    await Promise.all([
      this.authSessionService.removeAllSessions(sourceUserId),
      this.authSessionService.removeAllSessions(targetUserId),
    ]);
  }

  /** 以手机号账号身份签发新 token */
  private async issueMergedAccountToken(
    targetUserId: number,
    phone: string,
  ): Promise<AuthTokenResponseDto> {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { email: true },
    });

    return this.authSessionService.signToken(targetUserId, {
      phone,
      email: targetUser?.email ?? '',
      accountScope: 'purely_club',
    });
  }
}
