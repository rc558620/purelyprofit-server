import { loadPlanCatalog } from '../../purely-profit/member/platform-membership/platform-membership.query';
import type { PrismaExecutor } from '../../purely-profit/member/platform-membership/platform-membership.types';
import type { PulseAdminMemberRecordItemDto } from './dto/pulse-membership-admin-member-records.response.dto';
import {
  loadAdminOperatorNames,
  resolveAdminMemberDisplayName,
  resolveAdminMemberPhone,
} from './membership-admin-query.helper';
import type { MemberRecordRow } from './membership-admin-member-records.types';

/**
 * 行 → DTO：补齐门店身份、档位名与操作人名后下发。
 *
 * 补齐动作都在拿到本页行之后批量做：一次 `store.findMany` + 一次 `user.findMany`
 * 覆盖整页，避免逐行回库（N+1）。
 */
export async function buildMemberRecordItems(
  prisma: PrismaExecutor,
  rows: MemberRecordRow[],
): Promise<PulseAdminMemberRecordItemDto[]> {
  if (rows.length === 0) {
    return [];
  }

  const storeIds = [...new Set(rows.map((row) => row.storeId))];
  const operatorIds = [
    ...new Set(
      rows
        .map((row) => row.operatorUserId)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];
  // 档位目录只为改价审计服务：本页没有改价记录时不查，省一次往返
  const needsPlanCatalog = rows.some((row) => row.planId !== null);

  const [stores, operatorNameById, planCatalog] = await Promise.all([
    prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: {
        id: true,
        name: true,
        contactPhone: true,
        owner: {
          select: {
            email: true,
            name: true,
            realName: true,
            avatar: true,
            wechatPhone: true,
            lastActiveAt: true,
          },
        },
      },
    }),
    operatorIds.length === 0
      ? Promise.resolve(new Map<number, string>())
      : loadAdminOperatorNames(prisma, operatorIds),
    needsPlanCatalog ? loadPlanCatalog(prisma) : Promise.resolve([]),
  ]);

  const storeById = new Map(stores.map((store) => [store.id, store]));
  const planNameById = new Map(planCatalog.map((plan) => [plan.id, plan.name]));

  return rows.map((row) => {
    const store = storeById.get(row.storeId);
    const planName = row.planId
      ? (planNameById.get(row.planId) ?? row.planId)
      : row.planName;

    return {
      id: String(row.id),
      type: row.type,
      memberId: String(row.storeId),
      memberName: store ? resolveAdminMemberDisplayName(store) : '',
      memberPhone: store ? resolveAdminMemberPhone(store) : '',
      planName,
      amountDisplay: row.amountDisplay,
      pointsAwarded: row.pointsAwarded,
      channel: row.channel,
      operatorName:
        row.operatorName ??
        (typeof row.operatorUserId === 'number'
          ? (operatorNameById.get(row.operatorUserId) ?? null)
          : null),
      oldValueDisplay: row.oldValueDisplay,
      newValueDisplay: row.newValueDisplay,
      reason: row.reason,
      createdAt: row.createdAt.getTime(),
    };
  });
}
