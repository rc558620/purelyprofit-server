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
 * 计时费用计算（全程整数分运算，金额只向上取整一次）。
 * 规则：不足 1 分钟按 1 分钟计，分钟数向上取整，
 *       金额 = (分钟数 × 时薪分) / 60，向上取整到分。
 *
 * 禁止写成 `hourlyRateMoney.multiplyCeilToCent(minutes / 60)`：
 * `minutes / 60` 先做浮点除法会引入近似误差（如 70/60 的 double 略大于真值），
 * 再向上取整就会凭空多收 1 分（777 元/小时 × 70 分钟正确答案 906.50 元，
 * 浮点实现会得到 906.51 元）。这里先做整数乘法再除，最后只取整一次。
 */
export const calcTimeCostMoney = (
  startTime: number,
  endTime: number,
  hourlyRateMoney: Money,
): Money => {
  const minutes = calcDurationMinutes(startTime, endTime);
  const product = hourlyRateMoney.toDbCents() * minutes;
  return Money.fromDbCents(Math.ceil(product / 60));
};
