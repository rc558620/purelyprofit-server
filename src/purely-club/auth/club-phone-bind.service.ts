import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthAccountLookupService } from '../../purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import {
  buildClubMemberDisplayName,
  buildClubWechatMemberPhone,
} from '../../purely-profit/auth/auth.utils';
import { PrismaService, TX_TIMEOUT_LONG } from '../../prisma/prisma.service';
import { ClubAccountMergeService } from './club-account-merge.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';

/**
 * 手机号「首次绑定」（区别于换绑）：写入 wechat_phone、迁移占位手机号、
 * 必要时触发账号合并。
 *
 * 短信验证码入口与微信 getPhoneNumber 入口共用 `bindVerifiedPhone`——
 * 两者差异仅在「如何证明手机号归属」，绑定与合并逻辑完全一致。
 */
@Injectable()
export class ClubPhoneBindService {
  private readonly logger = new Logger(ClubPhoneBindService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authSessionService: AuthSessionService,
    private readonly clubAccountMergeService: ClubAccountMergeService,
  ) {}

  /**
   * 绑定「已完成归属验证」的手机号。
   *
   * - 若手机号已有账号 → 将当前微信 openid 合并到手机号账号：
   *   1. 迁移源用户（微信账号）的 Member 记录到目标用户（手机号账号）
   *   2. 迁移源用户的 Store ownership 到目标用户
   *   3. 将 openid 绑定到目标用户，清除源用户 openid
   * - 若手机号无账号 → 写入 wechatPhone，并把以 club_wechat:{openid}
   *   为占位 phone 的 Member / MarketingCustomer 迁移到真实手机号
   *
   * 合并操作包裹在数据库事务中，确保原子性。
   * 绑定成功后签发新 token，同时失效涉及的两端旧登录态。
   */
  async bindVerifiedPhone(
    userId: number,
    phone: string,
  ): Promise<AuthTokenResponseDto> {
    // 1. 查询当前用户
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        wechatOpenid: true,
        wechatUnionid: true,
        wechatNickname: true,
        wechatAvatar: true,
        wechatPhone: true,
      },
    });
    if (!currentUser) {
      throw new NotFoundException('用户不存在');
    }

    // 2. 检查手机号是否已有账号
    const existingPhoneUser =
      await this.authAccountLookupService.findUserByPhone(phone, 'purely_club');

    if (existingPhoneUser && existingPhoneUser.id !== userId) {
      // 手机号已有其他账号：事务性合并
      // 合并前检查目标账号是否已绑定其他微信 openid，
      // 避免合并时覆盖目标账号的 openid 导致其微信号登录失效
      const targetUser = await this.prisma.user.findUnique({
        where: { id: existingPhoneUser.id },
        select: { wechatOpenid: true },
      });
      if (targetUser?.wechatOpenid) {
        throw new ConflictException(
          '该手机号已绑定其他微信账号，无法自动合并，请联系客服',
        );
      }
      return this.clubAccountMergeService.mergeWechatUserToPhoneUser(
        userId,
        existingPhoneUser.id,
        phone,
        currentUser,
      );
    }

    // 3. 手机号无其他账号：绑定到当前用户，并迁移占位手机号记录
    // 防御性检查：当前账号已绑定手机号时拒绝，避免 wechatPhone 被静默覆盖
    if (currentUser.wechatPhone?.trim()) {
      throw new ConflictException('当前账号已绑定手机号，无需重复绑定');
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { wechatPhone: phone },
        });

        if (currentUser.wechatOpenid) {
          await this.migrateWechatPlaceholderPhone(
            tx,
            userId,
            currentUser.wechatOpenid,
            phone,
          );
        }
      },
      { timeout: TX_TIMEOUT_LONG },
    );

    // 4. 签发新 token（phone 更新为真实手机号）
    return this.authSessionService.signToken(userId, {
      phone,
      email: currentUser.email,
      accountScope: 'purely_club',
    });
  }

  /**
   * 将微信占位手机号（club_wechat:{openid}）迁移为真实手机号。
   *
   * 背景：微信无手机号用户以 club_wechat:{openid} 作为 Member / MarketingCustomer
   * 的 phone 占位值（见 ClubStoreAccessService.resolveMemberPhone 与
   * AuthAccountLookupService.findUserByWechatOpenid 的 phone 映射）。
   * 绑定手机号后 JWT 的 phone 立即切换为真实手机号，若不迁移这些记录：
   * - 用户查不到自己的门店（getAccessibleStores 按 Member.phone 匹配）
   * - 商家端（purelyProfit）拿不到该顾客的真实手机号
   *
   * 占位值由 openid 派生、在同一 appid 内全局唯一，因此批量更新不会误伤其他用户。
   */
  private async migrateWechatPlaceholderPhone(
    tx: Prisma.TransactionClient,
    userId: number,
    openid: string,
    phone: string,
  ): Promise<void> {
    const placeholderPhone = buildClubWechatMemberPhone(openid);

    // members 表仅有 (storeId, phone) 普通索引、无唯一约束，故直接批量更新；
    // 此处刻意不做「去重删除」，避免误删可能带纯利豆余额的会员记录。
    const memberResult = await tx.member.updateMany({
      where: { phone: placeholderPhone },
      data: { phone },
    });

    // marketing_customers 存在 uq_marketing_customers_store_club_user
    // 部分唯一索引（club_user_id IS NOT NULL），补充 clubUserId 时必须
    // 排除该门店已绑定同一用户的记录，否则触发唯一约束冲突。
    const alreadyBoundStoreIds = (
      await tx.marketingCustomer.findMany({
        where: { phone: placeholderPhone, clubUserId: userId },
        select: { storeId: true },
      })
    ).map((item) => item.storeId);

    // 未绑定该用户的门店：同步 phone 并补上 clubUserId，
    // 使后续按 user.id 精确匹配，避免同门店多个无手机号顾客时的回退歧义。
    const customerResult = await tx.marketingCustomer.updateMany({
      where: {
        phone: placeholderPhone,
        ...(alreadyBoundStoreIds.length > 0 && {
          storeId: { notIn: alreadyBoundStoreIds },
        }),
      },
      data: { phone, clubUserId: userId },
    });

    // 已绑定该用户的门店：仅同步 phone，保留原有绑定关系
    if (alreadyBoundStoreIds.length > 0) {
      await tx.marketingCustomer.updateMany({
        where: {
          phone: placeholderPhone,
          storeId: { in: alreadyBoundStoreIds },
        },
        data: { phone },
      });
    }

    // 兜底：仅带 club_user_id、phone 为 null 的营销顾客档案。
    // 扫码点餐链路的 resolveActiveCustomer 在用户尚未绑手机号时会把 phone 落成 null，
    // 这类记录匹配不到上面的占位值，若不补齐，商家端仍无法按手机号找到该顾客。
    // 已由上面处理过的门店跳过，避免同店出现两条同手机号档案。
    const nullPhoneBoundResult = await tx.marketingCustomer.updateMany({
      where: {
        clubUserId: userId,
        phone: null,
        ...(alreadyBoundStoreIds.length > 0 && {
          storeId: { notIn: alreadyBoundStoreIds },
        }),
      },
      data: { phone },
    });

    // 同步自动生成的展示名。占位手机号派生出的名字（如「纯利会员HR5Y」）取自 openid
    // 后 4 位，对商家没有意义；绑定真实手机号后应重新按手机号后 4 位生成。
    // 仅当名字确实是自动生成的那个才更新，避免覆盖商家在 purelyProfit 手动改过的名字。
    // 必须放在上面 phone 更新之后——where 用的是迁移后的新手机号。
    const previousAutoName = buildClubMemberDisplayName(placeholderPhone);
    const nextAutoName = buildClubMemberDisplayName(phone);

    const renamedMemberResult = await tx.member.updateMany({
      where: { phone, name: previousAutoName },
      data: { name: nextAutoName },
    });
    const renamedCustomerResult = await tx.marketingCustomer.updateMany({
      where: { phone, name: previousAutoName },
      data: { name: nextAutoName },
    });

    this.logger.log(
      `bindPhone 迁移占位手机号：${placeholderPhone} → ${phone}，` +
        `Member ${memberResult.count} 条，MarketingCustomer ${customerResult.count} 条，` +
        `仅 clubUserId 绑定补 phone ${nullPhoneBoundResult.count} 条，` +
        `展示名同步 Member ${renamedMemberResult.count} 条 / ` +
        `MarketingCustomer ${renamedCustomerResult.count} 条`,
    );
  }
}
