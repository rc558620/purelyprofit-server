/**
 * 团购券订单 DTO 统一出口。
 *
 * 为控制单文件行数，DTO 已按职责拆分：
 * - `club-voucher-order-request.dto.ts`：查询 / 创建 / 预览入参
 * - `club-voucher-order-response.dto.ts`：预览、详情、列表与创建响应
 *
 * 对外仍从此文件导出，避免影响既有引用路径。
 */
export * from './club-voucher-order-request.dto';
export * from './club-voucher-order-response.dto';
