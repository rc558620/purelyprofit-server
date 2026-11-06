import { PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES as LEGACY_POINTS_SOURCE_VALUES } from './pulse-membership-admin-logs.shared.dto';

/**
 * 管理端积分流水「响应侧」完整来源白名单。
 *
 * 旧 shared 常量只服务请求侧 Tab / 筛选（4 值），不承担响应字段类型；
 * 签到积分的审计来源 `check_in` 会由后端响应原样透传，必须纳入响应白名单、
 * 字段类型与 Swagger enum。两者职责不同，禁止再把响应字段写成
 * `[...旧常量, 'check_in']` 这种临时拼接，避免前端同步时再次漏项。
 */
export const PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES = [
  ...LEGACY_POINTS_SOURCE_VALUES,
  'check_in',
] as const;

export type PulseAdminMemberPointsSourceValue =
  (typeof PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES)[number];
