/** 签到活动配置行（DB 原始形态，params 为 JSON） */
export interface ClubCheckInPromotionRecord {
  id: number;
  enabled: boolean;
  startAt: Date;
  endAt: Date;
  params: unknown;
}

/** 已通过 enabled + 时间窗校验的生效活动（时间戳统一毫秒） */
export interface ClubCheckInActivePromotion {
  id: number;
  startAt: number;
  endAt: number;
  pointsPerCheckIn: number;
}

/** 当前登录用户在本店的顾客档案（两段锚定结果） */
export interface ClubCheckInCustomerRecord {
  id: number;
  points: number;
  memberId: number | null;
  clubUserId: number | null;
}

/** 提交前置校验结果：全部由服务端上下文与商家配置派生 */
export interface ClubCheckInSubmitState {
  storeId: number;
  customer: ClubCheckInCustomerRecord;
  promotion: ClubCheckInActivePromotion;
  checkInDate: string;
  awardedPoints: number;
  description: string;
  dedupKey: string;
}

/** 单事务写入参数：全部由服务端上下文派生，禁止来自 body/query */
export interface ClubCheckInWriteInput {
  storeId: number;
  customer: ClubCheckInCustomerRecord;
  promotion: ClubCheckInActivePromotion;
  clubUserId: number;
  checkInDate: string;
  description: string;
}

export interface ClubCheckInWriteResult {
  checkedInAt: number;
  pointsBalance: number;
}

/** 事务提交结果：含事务前读取的历史日期，用于推导连续天数 */
export interface ClubCheckInCommittedResult extends ClubCheckInWriteResult {
  previousCheckedDates: string[];
}

/** 关键写操作结构化日志载荷（禁止携带 token / 完整手机号） */
export interface ClubCheckInLogEvent {
  requestId: string;
  storeId: number;
  customerId: number;
  checkInDate: string;
  pointsAwarded: number;
  result: 'success' | 'failed';
  errorCode?: string;
}
