/**
 * 订单 DTO 统一出口。
 *
 * 为控制单文件行数，DTO 已按职责拆分：
 * - `club-order-request.dto.ts`：创建 / 预览 / 查询入参
 * - `club-order-payment.dto.ts`：微信支付参数与取参响应
 * - `club-order-response.dto.ts`：订单状态、价格拆解与订单响应
 *
 * 对外仍从此文件导出，避免影响既有引用路径。
 */
export * from './club-order-payment.dto';
export * from './club-order-request.dto';
export * from './club-order-response.dto';
