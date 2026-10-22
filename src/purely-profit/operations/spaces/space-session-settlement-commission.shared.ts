import type { Prisma } from '@prisma/client';
import { formatShanghaiYearMonth } from '../../../shared/shanghai-time.utils';
import { parseAssignmentsJson } from '../commission/commission.utils';
import type { CommissionAssignmentRecord } from '../commission/commission.types';
import type { CommissionCoreService } from '../commission/commission-core.service';
import type { SettleSpaceSessionParams } from './space-session-settlement.types';

/**
 * 结账时按配置重算会话提成分配（金额为分），生成 settled 提成记录，
 * 返回最终分配快照用于回写会话；无提成分配时返回 undefined。
 *
 * 从 SpaceSessionSettlementService 抽出的独立 helper：结账事务内只调用一次，
 * 抽出来是为了让结算主服务保持在单文件行数阈值内，同时让这一段可被独立阅读。
 */
export async function recomputeAndSettleCommissions(
  commissionCoreService: CommissionCoreService,
  transaction: Prisma.TransactionClient,
  params: SettleSpaceSessionParams,
): Promise<CommissionAssignmentRecord[] | undefined> {
  const rawAssignments = parseAssignmentsJson(
    params.session.commissionAssignments,
  );
  if (rawAssignments.length === 0) {
    return undefined;
  }

  const servicesMap = await commissionCoreService.buildServicesMap(
    transaction,
    params.session.storeId,
  );
  const finalAssignments = commissionCoreService.recomputeAssignments(
    servicesMap,
    rawAssignments,
  );

  const settledAt = new Date(params.checkoutAt);
  await commissionCoreService.createSettledRecords(transaction, {
    storeId: params.session.storeId,
    sessionId: params.session.id,
    spaceName: params.session.space.name,
    assignments: finalAssignments,
    settledAt,
    month: formatShanghaiYearMonth(settledAt.getTime()),
  });

  return finalAssignments;
}
