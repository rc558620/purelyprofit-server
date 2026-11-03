// 账号资料（昵称 / 头像）与各门店顾客档案的一致性同步
//
// 商家端开台识别、顾客列表、护理档案标题都读 `marketing_customers.name`，
// 而 C 端改昵称只写 `users.name`；不同步会让商家端一直显示建档时的旧名
// （如「纯利会员4010」）。`members.name` 属同一展示口径，一并同步。
import type { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/** 同步依赖：prisma 负责读写，logger 只记录降级告警 */
export interface ProfileSyncDeps {
  prisma: PrismaService;
  logger: Logger;
}

/**
 * 当前账号可能关联的手机号：微信绑定号 + 登录邮箱中解析出的手机号。
 *
 * 历史 club 账号用 `club_phone_{phone}@` 邮箱、早期 purely-profit 用
 * `phone_{phone}@`，两者都要覆盖，否则老账号的档案同步会漏。
 */
export const resolveLinkedPhones = async (
  prisma: PrismaService,
  userId: number,
): Promise<string[]> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { wechatPhone: true, email: true },
  });

  const phones: string[] = [];
  if (user?.wechatPhone) phones.push(user.wechatPhone);

  if (user?.email) {
    const clubMatch = user.email.match(/^club_phone_(\d+)@/);
    const legacyMatch = user.email.match(/^phone_(\d+)@/);
    if (clubMatch?.[1]) phones.push(clubMatch[1]);
    if (legacyMatch?.[1]) phones.push(legacyMatch[1]);
  }

  return phones;
};

/**
 * 把昵称写回该用户在各门店的顾客档案 / 会员档案。
 *
 * 归属优先按 `clubUserId` 精确定位；手机号只兜底 `clubUserId` 为空的孤儿档案，
 * 避免同门店同号的历史重复档案被连带改名。同步失败只告警，不阻断昵称更新主流程。
 */
export const syncNameToCustomerProfiles = async (
  deps: ProfileSyncDeps,
  userId: number,
  name: string,
): Promise<void> => {
  const { prisma, logger } = deps;
  const phones = await resolveLinkedPhones(prisma, userId);

  const customerOwnership: Prisma.MarketingCustomerWhereInput[] = [
    { clubUserId: userId },
  ];
  const memberOwnership: Prisma.MemberWhereInput[] = [{ clubUserId: userId }];
  if (phones.length > 0) {
    customerOwnership.push({ clubUserId: null, phone: { in: phones } });
    memberOwnership.push({ clubUserId: null, phone: { in: phones } });
  }

  try {
    await Promise.all([
      prisma.marketingCustomer.updateMany({
        where: { OR: customerOwnership, deletedAt: null },
        data: { name },
      }),
      prisma.member.updateMany({
        where: { OR: memberOwnership, deletedAt: null },
        data: { name },
      }),
    ]);
  } catch (error: unknown) {
    logger.warn(
      `同步顾客档案昵称失败：userId=${userId}，${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};
