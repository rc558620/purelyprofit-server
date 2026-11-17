import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { buildClubWechatMemberPhone } from '../../purely-profit/auth/auth.utils';
import {
  buildCustomerMergeStatements,
  buildMemberMergeStatements,
  type CustomerMergePair,
  type MemberMergePair,
} from './club-account-merge.statements';

/** 合并时命中的源 Member 记录 */
export interface MergeSourceMember {
  id: number;
  storeId: number;
  beanBalance: number;
}

/** 合并时命中的源营销顾客档案 */
export interface MergeSourceCustomer {
  id: number;
  storeId: number;
  balance: number;
  points: number;
  totalSpent: number;
  visitCount: number;
}

/** 源账号在各门店的会员档案集合 */
export interface MergeSourceMembership {
  members: MergeSourceMember[];
  customers: MergeSourceCustomer[];
}

/**
 * 串行执行批量语句。
 *
 * 交互式事务是单连接，`Promise.all` 只会排队等待，串行 await 语义更明确；
 * 语句本身已经是「一条 SQL 处理全部门店」，条数与门店数无关。
 */
export async function executeStatements(
  tx: Prisma.TransactionClient,
  statements: Prisma.Sql[],
): Promise<void> {
  for (const statement of statements) {
    await tx.$executeRaw(statement);
  }
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
export async function resolveSourceMembership(
  tx: Prisma.TransactionClient,
  sourceUserId: number,
  sourceWechatOpenid: string,
  sourcePhone: string | null,
): Promise<MergeSourceMembership> {
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

/**
 * 迁移源用户在各门店的 Member 档案。
 *
 * - 目标门店没有 Member → 直接把 phone 改到目标用户；
 * - 目标门店已有 Member → 先结转纯利豆再**软删除**源 Member。
 *
 * 不硬删：纯利豆 / 积分 / 充值流水是必填外键且没有级联，硬删会直接抛错；
 * 同时必须清空 phone —— `findAccessibleStores` 的 `members.some({ phone })`
 * 不过滤 `deletedAt`，留着旧号会让将来绑了这个号的人看到本用户的门店。
 *
 * 逐门店的两条 update 收敛为事务末尾两条集合 UPDATE
 * （见 `club-account-merge.statements`）：事务往返次数与门店数解耦。
 */
export async function mergeMemberProfiles(
  tx: Prisma.TransactionClient,
  logger: Logger,
  sourceMembers: MergeSourceMember[],
  phone: string,
  mergedAt: Date,
): Promise<void> {
  if (sourceMembers.length === 0) return;

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
  const memberMergePairs: MemberMergePair[] = [];

  for (const sourceMember of sourceMembers) {
    const targetMember = targetMemberByStoreId.get(sourceMember.storeId);

    if (!targetMember) {
      sourceMemberIdsToUpdate.push(sourceMember.id);
      logger.log(
        `bindPhone 合并 Member：门店 ${sourceMember.storeId} 将源 Member ${sourceMember.id} 的 phone 更新为 ${phone}`,
      );
      continue;
    }

    memberMergePairs.push({
      targetId: targetMember.id,
      sourceId: sourceMember.id,
      beanBalance: sourceMember.beanBalance,
    });
    logger.log(
      `bindPhone 合并 Member：门店 ${sourceMember.storeId} 目标已有 Member ${targetMember.id}，` +
        `结转纯利豆 ${sourceMember.beanBalance} 后软删除源 Member ${sourceMember.id}`,
    );
  }

  await executeStatements(
    tx,
    buildMemberMergeStatements(memberMergePairs, mergedAt),
  );

  if (sourceMemberIdsToUpdate.length > 0) {
    await tx.member.updateMany({
      where: { id: { in: sourceMemberIdsToUpdate } },
      data: { phone },
    });
  }
}

/**
 * 迁移营销顾客档案：储值余额 / 积分 / 消费记录都挂在它上面。
 *
 * 此前合并完全没搬这类档案，用户在新账号里会凭空「没有资产」。
 *
 * - 目标门店没有档案 → 改绑 clubUserId 并同步为新手机号；
 * - 目标门店已有档案 → 资产并入后软删除源档案（同样不硬删：消费 / 积分 /
 *   充值流水是必填外键且无级联）。
 */
export async function mergeCustomerProfiles(
  tx: Prisma.TransactionClient,
  logger: Logger,
  sourceCustomers: MergeSourceCustomer[],
  targetUserId: number,
  phone: string,
  mergedAt: Date,
): Promise<void> {
  if (sourceCustomers.length === 0) return;

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
  const customerMergePairs: CustomerMergePair[] = [];

  for (const sourceCustomer of sourceCustomers) {
    const targetCustomer = targetCustomerByStoreId.get(sourceCustomer.storeId);

    if (!targetCustomer) {
      customerIdsToRebind.push(sourceCustomer.id);
      continue;
    }

    customerMergePairs.push({
      targetId: targetCustomer.id,
      sourceId: sourceCustomer.id,
      balance: sourceCustomer.balance,
      points: sourceCustomer.points,
      totalSpent: sourceCustomer.totalSpent,
      visitCount: sourceCustomer.visitCount,
    });
    logger.log(
      `bindPhone 合并 MarketingCustomer：门店 ${sourceCustomer.storeId} 目标已有档案 ${targetCustomer.id}，` +
        `并入余额 ${sourceCustomer.balance} / 积分 ${sourceCustomer.points} 后软删除源档案 ${sourceCustomer.id}`,
    );
  }

  await executeStatements(
    tx,
    buildCustomerMergeStatements(customerMergePairs, mergedAt),
  );

  if (customerIdsToRebind.length > 0) {
    await tx.marketingCustomer.updateMany({
      where: { id: { in: customerIdsToRebind } },
      data: { clubUserId: targetUserId, phone },
    });
  }
}
