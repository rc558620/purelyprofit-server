/**
 * 提成 JSONB 字段解析工具：DB 中可能存在历史/脏数据，非法元素直接丢弃。
 */
import type {
  CommissionAssignmentRecord,
  CommissionOverrideRecord,
} from './commission.types';

/** 覆盖表 JSON 元素校验：非法元素直接丢弃，避免脏数据污染解析。 */
export const parseOverridesJson = (
  value: unknown,
): CommissionOverrideRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): CommissionOverrideRecord[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const technicianId = Number(
      (entry as { technicianId?: unknown }).technicianId,
    );
    const commission = Number((entry as { commission?: unknown }).commission);
    if (!Number.isInteger(technicianId) || technicianId <= 0) {
      return [];
    }
    if (!Number.isFinite(commission) || commission < 0) {
      return [];
    }

    return [{ technicianId, commission: Math.round(commission) }];
  });
};

/** 分配快照 JSON 元素校验：非法元素直接丢弃。 */
export const parseAssignmentsJson = (
  value: unknown,
): CommissionAssignmentRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): CommissionAssignmentRecord[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record = entry as Partial<CommissionAssignmentRecord>;
    const technicianId = Number(record.technicianId);
    const commission = Number(record.commission);
    if (!Number.isInteger(technicianId) || technicianId <= 0) {
      return [];
    }
    if (!Number.isFinite(commission) || commission < 0) {
      return [];
    }

    return [
      {
        technicianId,
        technicianName: String(record.technicianName ?? ''),
        serviceIds: (Array.isArray(record.serviceIds) ? record.serviceIds : [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0),
        serviceNames: (Array.isArray(record.serviceNames)
          ? record.serviceNames
          : []
        ).map((name) => String(name ?? '')),
        commission: Math.round(commission),
      },
    ];
  });
};
