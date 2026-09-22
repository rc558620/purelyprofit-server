import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { buildClubWechatMemberPhone } from '../../purely-profit/auth/auth.utils';
import { PrismaService, TX_TIMEOUT_LONG } from '../../prisma/prisma.service';
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

interface MergeSourceMember {
  id: number;
  storeId: number;
  beanBalance: number;
}

interface MergeSourceCustomer {
  id: number;
  storeId: number;
  balance: number;
  points: number;
  totalSpent: number;
  visitCount: number;
}

/**
 * 账号合并：把微信账号（源）的 openid、会员档案、门店归属合到手机号账号（目标）。
 *
 * 从 ClubAuthService 抽离，因为它是「绑定手机号」的一个分支（手机号已有账号时），
 * 换绑路径完全用不到它。
 */
@Injectable()
export class ClubAccountMergeService {
  private readonly logger = new Logger(ClubAccountMergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  /**
   * 事务性合并：将微信用户的 openid、Member 记录和 Store ownership 迁移到手机号账号
   *
   * 合并步骤（全部在同一个数据库事务中）：
   * 1. 迁移源用户（微信账号）在各门店的 Member / MarketingCustomer 档案到目标用户
   *    - 同一门店下目标用户已有档案 → 先把源档案的资产（纯利豆 / 储值 / 积分）
   *      并入目标档案，再**软删除**源档案并清空 phone
   *    - 同一门店下目标用户无档案 → 直接将源档案的 phone / clubUserId 改到目标用户
   * 2. 迁移源用户的 Store ownership（ownerId）到目标用户
   * 3. 将 openid 从源用户移到目标用户，清除源用户的微信相关字段
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
        '当前微信账号缺少 openid，无法完成合并，请联系客服',
      );
    }

    // 取局部常量：闭包内 TS 不会保留对 sourceUser 字段的收窄
    const sourceOpenid = sourceUser.wechatOpenid;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // 1. 迁移会员档案（Member + MarketingCustomer）
          //    定位方式见 resolveSourceMembership —— 不再假设 phone 还是占位值
          const { members: sourceMembers, customers: sourceCustomers } =
            await this.resolveSourceMembership(
              tx,
              sourceUserId,
              sourceOpenid,
              sourceUser.wechatPhone,
            );

          if (sourceMembers.length > 0) {
            // 批量查询目标用户在这些门店是否已有 Member 记录，避免逐个 findUnique
            const storeIds = sourceMembers.map((m) => m.storeId);
            const targetMembers = await tx.member.findMany({
              where: { storeId: { in: storeIds }, phone },
              select: { id: true, storeId: true },
            });
            const targetMemberByStoreId = new Map(
              targetMembers.map((m) => [m.storeId, m]),
            );

            const sourceMemberIdsToUpdate: number[] = [];

            for (const sourceMember of sourceMembers) {
              const targetMember = targetMemberByStoreId.get(
                sourceMember.storeId,
              );

              if (!targetMember) {
                sourceMemberIdsToUpdate.push(sourceMember.id);
                this.logger.log(
                  `bindPhone 合并 Member：门店 ${sourceMember.storeId} 将源 Member ${sourceMember.id} 的 phone 更新为 ${phone}`,
                );
                continue;
              }

              // 目标门店已有 Member：先把纯利豆结转过去，再软删除源 Member。
              // 不硬删：纯利豆 / 积分 / 充值流水是必填外键且没有级联，硬删会直接抛错；
              // 同时必须清空 phone —— findAccessibleStores 的 members.some({ phone })
              // 不过滤 deletedAt，留着旧号会让将来绑了这个号的人看到本用户的门店。
              if (sourceMember.beanBalance > 0) {
                await tx.member.update({
                  where: { id: targetMember.id },
                  data: {
                    beanBalance: { increment: sourceMember.beanBalance },
                  },
                });
              }
              await tx.member.update({
                where: { id: sourceMember.id },
                data: { phone: null, deletedAt: new Date() },
              });
              this.logger.log(
                `bindPhone 合并 Member：门店 ${sourceMember.storeId} 目标已有 Member ${targetMember.id}，` +
                  `结转纯利豆 ${sourceMember.beanBalance} 后软删除源 Member ${sourceMember.id}`,
              );
            }

            if (sourceMemberIdsToUpdate.length > 0) {
              await tx.member.updateMany({
                where: { id: { in: sourceMemberIdsToUpdate } },
                data: { phone },
              });
            }
          }

          // 1.2 迁移营销顾客档案：储值余额 / 积分 / 消费记录都挂在它上面。
          //     此前合并完全没搬这类档案，用户在新账号里会凭空"没有资产"。
          if (sourceCustomers.length > 0) {
            const targetCustomers = await tx.marketingCustomer.findMany({
              where: {
                storeId: { in: sourceCustomers.map((c) => c.storeId) },
                clubUserId: targetUserId,
              },
              select: { id: true, storeId: true },
            });
            const targetCustomerByStoreId = new Map(
              targetCustomers.map((c) => [c.storeId, c]),
            );

            const customerIdsToRebind: number[] = [];

            for (const sourceCustomer of sourceCustomers) {
              const targetCustomer = targetCustomerByStoreId.get(
                sourceCustomer.storeId,
              );

              if (!targetCustomer) {
                customerIdsToRebind.push(sourceCustomer.id);
                continue;
              }

              // 目标门店已有顾客档案：把资产并入后软删除源档案
              //（同样不硬删：消费 / 积分 / 充值流水是必填外键且无级联）
              await tx.marketingCustomer.update({
                where: { id: targetCustomer.id },
                data: {
                  balance: { increment: sourceCustomer.balance },
                  points: { increment: sourceCustomer.points },
                  totalSpent: { increment: sourceCustomer.totalSpent },
                  visitCount: { increment: sourceCustomer.visitCount },
                },
              });
              await tx.marketingCustomer.update({
                where: { id: sourceCustomer.id },
                data: { clubUserId: null, phone: null, deletedAt: new Date() },
              });
              this.logger.log(
                `bindPhone 合并 MarketingCustomer：门店 ${sourceCustomer.storeId} 目标已有档案 ${targetCustomer.id}，` +
                  `并入余额 ${sourceCustomer.balance} / 积分 ${sourceCustomer.points} 后软删除源档案 ${sourceCustomer.id}`,
              );
            }

            // 目标在该门店没有档案：直接改绑 clubUserId 并同步为新手机号
            if (customerIdsToRebind.length > 0) {
              await tx.marketingCustomer.updateMany({
                where: { id: { in: customerIdsToRebind } },
                data: { clubUserId: targetUserId, phone },
              });
            }
          }

          // 2. 迁移 Store ownership（源用户拥有的门店转移到目标用户）
          const ownedStores = await tx.store.findMany({
            where: { ownerId: sourceUserId, deletedAt: null },
            select: { id: true },
          });

          if (ownedStores.length > 0) {
            await tx.store.updateMany({
              where: { ownerId: sourceUserId },
              data: { ownerId: targetUserId },
            });
            this.logger.log(
              `bindPhone 合并 Store ownership：将 ${ownedStores.length} 个门店从用户 ${sourceUserId} 转移到用户 ${targetUserId}`,
            );
          }

          // 3. 先清除源用户的微信相关字段（必须在绑定到目标用户之前执行），
          //    否则 wechat_openid 的唯一约束会导致写入目标用户时冲突
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

          // 4. 将 openid 绑定到目标用户，同时写入 wechatPhone
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
        },
        { timeout: TX_TIMEOUT_LONG },
      );
    } catch (error) {
      this.logger.error(
        `bindPhone 合并事务失败：sourceUserId=${sourceUserId}, targetUserId=${targetUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ConflictException('账号合并失败，请重试或联系客服');
    }

    // 失效两端的旧登录态，确保合并后旧 token 立即无效
    await Promise.all([
      this.authSessionService.bumpTokenVersion(sourceUserId),
      this.authSessionService.bumpTokenVersion(targetUserId),
    ]);

    // 签发新 token（以手机号账号身份登录）
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

  /**
   * 定位源用户在各门店的会员档案（Member + MarketingCustomer）。
   *
   * **不能假设 `Member.phone` 还是占位值 `club_wechat:{openid}`**：用户可能先绑过
   * 一个手机号（那时 `migrateWechatPlaceholderPhone` 已把 Member.phone 迁成真实号码），
   * 之后才绑到另一个已有账号上触发合并。只按占位值查找会**一条都找不到**，
   * 结果是 openid 合过去了、会员档案与资产全留在源账号上。
   *
   * Member 既没有 `clubUserId`，`customerId` 在现存数据里又全为 null，
   * 因此只能以 `MarketingCustomer.clubUserId` 为**权威桥梁**先拿到门店范围，
   * 再在该范围内按「可能的手机号」定位；同时保留按占位值全局定位
   * （占位值由 openid 派生、在同一 appid 内天然唯一）。
   *
   * @param sourcePhone 源用户当前已绑定的手机号，可能是真实号码而非占位值
   */
  private async resolveSourceMembership(
    tx: Prisma.TransactionClient,
    sourceUserId: number,
    sourceWechatOpenid: string,
    sourcePhone: string | null,
  ): Promise<{
    members: MergeSourceMember[];
    customers: MergeSourceCustomer[];
  }> {
    const placeholderPhone = buildClubWechatMemberPhone(sourceWechatOpenid);
    const candidatePhones = Array.from(
      new Set(
        [placeholderPhone, sourcePhone].filter(
          (value): value is string => !!value && value.trim().length > 0,
        ),
      ),
    );

    const customers = await tx.marketingCustomer.findMany({
      where: { clubUserId: sourceUserId },
      select: {
        id: true,
        storeId: true,
        balance: true,
        points: true,
        totalSpent: true,
        visitCount: true,
      },
    });
    const storeIds = customers.map((item) => item.storeId);

    // 占位值定位：覆盖「有 Member 但尚未建立 clubUserId 关联」的历史形态
    const membersByPlaceholder = await tx.member.findMany({
      where: { phone: placeholderPhone },
      select: { id: true, storeId: true, beanBalance: true },
    });

    // 门店范围 + 候选手机号：覆盖「已迁到真实号码」的形态
    const membersInScopedStores =
      storeIds.length > 0
        ? await tx.member.findMany({
            where: {
              storeId: { in: storeIds },
              phone: { in: candidatePhones },
            },
            select: { id: true, storeId: true, beanBalance: true },
          })
        : [];

    // 正向关联（customerId 将来会被填充），有则用其精确定位
    const membersByCustomerLink =
      customers.length > 0
        ? await tx.member.findMany({
            where: { customerId: { in: customers.map((item) => item.id) } },
            select: { id: true, storeId: true, beanBalance: true },
          })
        : [];

    // 三条路径可能命中同一条记录，按 id 去重
    const membersById = new Map<number, MergeSourceMember>();
    for (const member of [
      ...membersByPlaceholder,
      ...membersInScopedStores,
      ...membersByCustomerLink,
    ]) {
      membersById.set(member.id, member);
    }

    return { members: [...membersById.values()], customers };
  }
}
