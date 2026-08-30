/**
 * 提成模块映射器：DB 记录（分）→ 响应 DTO（元）。
 */
import { Money } from '../../../shared/money.utils';
import type { CommissionRecordResponseDto } from './dto/commission-record.dto';
import type { CommissionServiceResponseDto } from './dto/commission-service.dto';
import type { CommissionRecordRow } from './commission.types';
import type { CommissionServiceConfigRecord } from './commission.types';

/** 服务配置行 → 响应 DTO（覆盖表金额分→元）。 */
export const toCommissionServiceResponse = (
  record: CommissionServiceConfigRecord,
): CommissionServiceResponseDto => ({
  id: record.id,
  name: record.name,
  defaultCommission: Money.fromDbCents(record.defaultCommission).toOutputYuan(),
  enabled: record.enabled,
  sortOrder: record.sortOrder,
  overrides: record.overrides.map((override) => ({
    technicianId: override.technicianId,
    commission: Money.fromDbCents(override.commission).toOutputYuan(),
  })),
  createdAt: record.createdAt.getTime(),
  updatedAt: record.updatedAt.getTime(),
});

/** 提成记录行 → 响应 DTO（金额分→元）。 */
export const toCommissionRecordResponse = (
  row: CommissionRecordRow,
): CommissionRecordResponseDto => ({
  id: row.id,
  sessionId: row.sessionId,
  spaceName: row.spaceName,
  technicianId: row.technicianId,
  technicianName: row.technicianName,
  serviceIds: row.serviceIds,
  serviceNames: row.serviceNames,
  serviceCommissions: row.serviceCommissions.map((commission) =>
    Money.fromDbCents(commission).toOutputYuan(),
  ),
  commission: Money.fromDbCents(row.commission).toOutputYuan(),
  status: row.status,
  settledAt: row.settledAt.getTime(),
  createdAt: row.createdAt.getTime(),
});
