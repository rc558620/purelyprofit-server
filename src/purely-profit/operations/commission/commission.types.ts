/**
 * 提成模块共享类型。
 * 金额口径统一为「分」（Int），与全仓 money 约定一致；
 * JSONB 内的 commission 同样为分，对外响应统一换算为元。
 */

/** 提成覆盖项（commission_service.overrides JSON 元素，金额为分）。 */
export interface CommissionOverrideRecord {
  technicianId: number;
  commission: number;
}

/** 技师提成分配（space_session.commission_assignments JSON 元素，金额为分）。 */
export interface CommissionAssignmentRecord {
  technicianId: number;
  technicianName: string;
  serviceIds: number[];
  serviceNames: string[];
  commission: number;
  /** 每服务提成金额（分，与 serviceIds 对齐）。结账重算时生成，用于提成记录拆分展示。 */
  serviceCommissions?: number[];
}

/** 提成服务配置行（业务视图，金额为分）。 */
export interface CommissionServiceConfigRecord {
  id: number;
  storeId: number;
  name: string;
  defaultCommission: number;
  enabled: boolean;
  sortOrder: number;
  overrides: CommissionOverrideRecord[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 提成记录状态。 */
export type CommissionRecordStatusValue =
  | 'pending'
  | 'settled'
  | 'included'
  | 'cancelled';

/** 提成记录行（业务视图，金额为分）。 */
export interface CommissionRecordRow {
  id: number;
  storeId: number;
  sessionId: number;
  spaceName: string;
  technicianId: number;
  technicianName: string;
  serviceIds: number[];
  serviceNames: string[];
  /** 每服务提成金额（分，与 serviceIds 对齐）。 */
  serviceCommissions: number[];
  commission: number;
  status: CommissionRecordStatusValue;
  settledAt: Date;
  month: string;
  createdAt: Date;
}

/** 开台提交的提成分配（金额为元，来自前端；commission 可缺省由后端重算）。 */
export interface CommissionAssignmentInput {
  technicianId: number;
  technicianName?: string;
  serviceIds: number[];
  serviceNames?: string[];
  commission?: number;
}

/** 提成记录批量生成入参。 */
export interface CreateCommissionRecordsInput {
  storeId: number;
  sessionId: number;
  spaceName: string;
  assignments: CommissionAssignmentRecord[];
  settledAt: Date;
  month: string;
}
