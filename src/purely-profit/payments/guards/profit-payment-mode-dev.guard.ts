import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ProfitPaymentModeService } from '../profit-payment-mode.service';

/**
 * dev-only 支付模式调试接口的可用性校验。
 *
 * 用 Guard 而不是在 controller 方法体里判断，是为了让「路由不可用」发生在
 * ValidationPipe 之前：管道先于方法体执行，若等到方法体内才抛 404，
 * 生产环境携带非法 body 的探测请求会先被全局校验管道拦成 400，
 * 反而坐实「该路由存在」，破坏 404 伪装。
 *
 * 生产环境或未开启切换开关时统一抛 NotFoundException（而非 403），
 * 避免向外部暴露该调试接口的存在。
 */
@Injectable()
export class ProfitPaymentModeDevGuard implements CanActivate {
  constructor(
    private readonly profitPaymentModeService: ProfitPaymentModeService,
  ) {}

  canActivate(): boolean {
    if (
      this.profitPaymentModeService.isProduction() ||
      !this.profitPaymentModeService.isSwitchEnabled()
    ) {
      throw new NotFoundException();
    }
    return true;
  }
}
