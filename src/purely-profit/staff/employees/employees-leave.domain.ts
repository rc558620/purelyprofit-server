import { BadRequestException } from '@nestjs/common';

export interface LeaveBusinessRuleInput {
  startDate: number;
  endDate: number;
  days: number;
  deductSalary: boolean;
  deductAmount: number;
}

/**
 * 根据请假开始/结束时间戳计算请假天数。
 * 规则（与前端 purelyProfit getDaysBetween 对齐）：
 *   8 小时 = 1 天
 *   剩余 ≥ 4 小时 = 0.5 天
 *   最小 0.5 天
 *
 * @param startDate 开始时间戳（毫秒）
 * @param endDate   结束时间戳（毫秒）
 * @returns 请假天数（0.5 的倍数）
 * @throws BadRequestException 当 endDate <= startDate 时
 */
export function calculateLeaveDays(startDate: number, endDate: number): number {
  if (endDate <= startDate) {
    throw new BadRequestException('请假开始时间必须早于结束时间');
  }

  const totalMinutes = Math.round((endDate - startDate) / 60000);
  const totalHours = totalMinutes / 60;

  const fullDays = Math.floor(totalHours / 8);
  const remainHours = totalHours % 8;
  const halfDay = remainHours >= 4 ? 0.5 : 0;

  const result = fullDays + halfDay;
  return result > 0 ? result : 0.5;
}

export function assertLeaveBusinessRules(input: LeaveBusinessRuleInput): void {
  if (input.startDate > input.endDate) {
    throw new BadRequestException('请假开始时间不能晚于结束时间');
  }
  if (input.days <= 0) {
    throw new BadRequestException('请假天数必须大于 0');
  }
  if (!input.deductSalary && input.deductAmount > 0) {
    throw new BadRequestException('未扣薪的请假记录扣款金额必须为 0');
  }
}
