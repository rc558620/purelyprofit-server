export const SPACE_STATUS_VALUES = [
  'idle',
  'occupied',
  'reserved',
  'cleaning',
] as const;

export const SPACE_RESERVATION_STATUS_VALUES = [
  'pending',
  'fulfilled',
  'cancelled',
] as const;

export const SPACE_RESERVATION_STATUS_LABELS = {
  pending: '待履约（顾客已预约，尚未到店开台）',
  fulfilled: '已履约（顾客已到店，预约已完成履约）',
  cancelled: '已取消（预约已取消，不再参与排台）',
} as const;

export const SPACE_RESERVATION_STATUS_SWAGGER_DESCRIPTION =
  '状态说明：pending=待履约（顾客已预约，尚未到店开台）；fulfilled=已履约（顾客已到店，预约已完成履约）；cancelled=已取消（预约已取消，不再参与排台）';

export const SPACE_SESSION_STATUS_VALUES = ['active', 'settled'] as const;

export const SPACE_BILLING_MODE_VALUES = [
  'timed',
  'items',
  'mixed',
  'countdown',
] as const;

/**
 * 空间追加点单扣库存的流水备注（供交班页面人读）。
 *
 * ⚠️ 该文案**不再参与结账回填**：回填已改为按 `related_space_session_id` 等值定位。
 * 历史流水靠一次性迁移把会话号从旧文案解析进新列，因此这里可以自由改文案。
 */
export const buildSpaceAddItemInventoryNote = (sessionId: number): string =>
  `空间管理追加点单（会话#${sessionId}）`;

export type SpaceStatusValue = (typeof SPACE_STATUS_VALUES)[number];
export type SpaceReservationStatusValue =
  (typeof SPACE_RESERVATION_STATUS_VALUES)[number];
export type SpaceSessionStatusValue =
  (typeof SPACE_SESSION_STATUS_VALUES)[number];
export type SpaceBillingModeValue = (typeof SPACE_BILLING_MODE_VALUES)[number];
