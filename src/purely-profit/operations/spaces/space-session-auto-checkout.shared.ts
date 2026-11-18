import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/**
 * 构建后台自动结账使用的系统用户。
 *
 * 该用户无实际 membership：销售单创建直接使用传入的可信门店，
 * 且 operatorStaffId / operatorNameSnapshot 均为 null（见 resolveOperatorStaffId），
 * 交班页按「空间自动结账」兜底展示，避免把自动结账记到某个虚拟操作人名下。
 */
export const createAutoCheckoutSystemUser = (): AuthenticatedUser => ({
  id: 0,
  email: 'system@auto-checkout',
  phone: '',
  name: '系统自动结账',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastActiveAt: null,
  currentMembership: null,
});

export const resolveAutoCheckoutAt = (
  session: {
    startTime: Date;
    countdownMinutes: number | null;
  },
  _renewRecords: Array<{
    addedMinutes: number;
  }>,
): number | null => {
  // 契约断言：countdownMinutes 必须是累计值（由 renew.service 在续费时累加）。
  // 如果此断言失败，说明续费实现已变更为"只写 renewRecords 不累加 countdownMinutes"，
  // 需要修改此函数改为从 renewRecords 推导。
  // _renewRecords 参数保留以支持未来从 renewRecords 推导的迁移路径。
  if (session.countdownMinutes === null || session.countdownMinutes <= 0) {
    return null;
  }

  // B1 fix: countdownMinutes 已是累计值（续费时由 space-session-renew.service
  // 直接累加），不应再叠加 renewRecords.addedMinutes，否则续费分钟被双重计算。
  return session.startTime.getTime() + session.countdownMinutes * 60 * 1000;
};

export const buildAutoCheckoutLogContext = (params: {
  trigger: string;
  storeId: number;
  requestId?: string;
  userId?: number;
  sessionId?: number;
  count?: number;
  failedCount?: number;
  skippedNoPaymentCount?: number;
  /** 认领失败的跳过数：另一路调度已认领该会话（多 worker / 手工结账交界） */
  skippedClaimedCount?: number;
  reason?: string;
}): string => {
  const segments = [
    `trigger=${params.trigger}`,
    `storeId=${params.storeId}`,
    ...(params.requestId ? [`requestId=${params.requestId}`] : []),
    ...(params.userId !== undefined ? [`userId=${params.userId}`] : []),
    ...(params.sessionId !== undefined
      ? [`sessionId=${params.sessionId}`]
      : []),
    ...(params.count !== undefined ? [`count=${params.count}`] : []),
    ...(params.failedCount !== undefined
      ? [`failedCount=${params.failedCount}`]
      : []),
    ...(params.skippedNoPaymentCount !== undefined
      ? [`skippedNoPaymentCount=${params.skippedNoPaymentCount}`]
      : []),
    ...(params.skippedClaimedCount !== undefined
      ? [`skippedClaimedCount=${params.skippedClaimedCount}`]
      : []),
    ...(params.reason ? [`reason=${params.reason}`] : []),
  ];

  return segments.join(' ');
};
