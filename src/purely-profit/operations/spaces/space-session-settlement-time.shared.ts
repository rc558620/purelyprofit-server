import { Money } from '../../../shared/money.utils';

export const calcDurationMinutes = (
  startTime: number,
  endTime: number,
): number => {
  const rawMinutes = (endTime - startTime) / (1000 * 60);
  return Math.max(1, Math.ceil(rawMinutes));
};

export const formatDurationLabel = (durationMinutes: number): string => {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  return hours > 0
    ? `${hours}小时${minutes > 0 ? `${minutes}分钟` : ''}`
    : `${minutes}分钟`;
};

/**
 * 计时费用计算（全程 Money 运算，金额向上取整到分）。
 * 规则：不足 1 分钟按 1 分钟计，分钟数向上取整，
 *       金额 = (分钟数 / 60) × 时薪，向上取整到分。
 */
export const calcTimeCostMoney = (
  startTime: number,
  endTime: number,
  hourlyRateMoney: Money,
): Money => {
  const minutes = calcDurationMinutes(startTime, endTime);
  // minutes / 60 是乘数（如 90分钟 = 1.5 小时）
  // 用 multiplyCeilToCent 保证结果向上取整到分
  return hourlyRateMoney.multiplyCeilToCent(minutes / 60);
};
