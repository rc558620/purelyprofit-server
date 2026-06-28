// 从 shared 重新导出统一工具函数，保持现有导入路径向后兼容
export {
  calcRatioPercent as calculateRatioPercent,
  calcPercentChangeWithFallback as calculatePercentChange,
} from '../../shared/money.utils';

import Decimal from 'decimal.js';

export function subtractMoney(minuend: number, subtrahend: number): number {
  return new Decimal(minuend).minus(subtrahend).toNumber();
}
