import { NotFoundException } from '@nestjs/common';
import { ProfitPaymentModeService } from '../profit-payment-mode.service';
import { ProfitPaymentModeDevGuard } from './profit-payment-mode-dev.guard';

/**
 * dev-only 支付模式调试接口的可用性守卫。
 *
 * 这里是「生产不可达」红线的执行点：守卫必须在参数校验管道之前
 * 就把请求拦成 404，否则生产环境携带非法 body 的探测会拿到 400。
 */
describe('ProfitPaymentModeDevGuard', () => {
  const buildGuard = (
    isProduction: boolean,
    isSwitchEnabled: boolean,
  ): ProfitPaymentModeDevGuard =>
    new ProfitPaymentModeDevGuard({
      isProduction: () => isProduction,
      isSwitchEnabled: () => isSwitchEnabled,
    } as unknown as ProfitPaymentModeService);

  it('生产环境伪装为路由不存在', () => {
    const guard = buildGuard(true, true);

    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it('未开启切换开关时伪装为路由不存在', () => {
    const guard = buildGuard(false, false);

    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it('非生产且已开启切换开关时放行', () => {
    const guard = buildGuard(false, true);

    expect(guard.canActivate()).toBe(true);
  });
});
