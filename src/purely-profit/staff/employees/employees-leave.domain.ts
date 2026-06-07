import { BadRequestException } from '@nestjs/common';

export interface LeaveBusinessRuleInput {
  startDate: number;
  endDate: number;
  days: number;
  deductSalary: boolean;
  deductAmount: number;
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
