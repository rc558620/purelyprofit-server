import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ScanOrderingOrderTransitionEngineService } from './scan-ordering-order-transition.service';
import { ScanOrderingOrderRefundHandlingService } from './scan-ordering-order-refund.service';

/**
 * 商家扫码点餐订单状态机服务（代理层）。
 *
 * 职责：协调状态转换和退款处理服务。
 * 原实现已拆分为：
 * - ScanOrderingOrderTransitionEngineService：接单、出餐、取消、完成等状态流转
 * - ScanOrderingOrderRefundHandlingService：拒单退款流程、退款完成操作
 */
export class ScanOrderingOrderStateMachineService {
  constructor(
    private readonly transitionEngine: ScanOrderingOrderTransitionEngineService,
    private readonly refundHandler: ScanOrderingOrderRefundHandlingService,
  ) {}

  async acceptOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    return this.transitionEngine.acceptOrder(user, orderId, version);
  }

  async serveOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    return this.transitionEngine.serveOrder(user, orderId, version);
  }

  async rejectOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    return this.refundHandler.rejectOrder(user, orderId, version, reason);
  }

  async cancelOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    return this.transitionEngine.cancelOrder(user, orderId, version, reason);
  }

  async completeOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    return this.transitionEngine.completeOrder(user, orderId, version);
  }

  async completeRefund(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    providerRefundNo?: string,
    providerRefundId?: string,
  ): Promise<void> {
    return this.refundHandler.completeRefund(
      user,
      orderId,
      version,
      providerRefundNo,
      providerRefundId,
    );
  }
}
