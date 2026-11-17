// 客存 B 端出参 DTO 统一出口：字段与前端 custodyManagement.types 对齐
/**
 * 为控制单文件行数，已按用途拆分：
 * - `custody-order-response.dto.ts`：存单、取出流水、核销预览与统计
 * - `custody-settings-response.dto.ts`：门店客存配置
 *
 * 对外仍从此文件导出，避免影响既有引用路径。
 */
export * from './custody-order-response.dto';
export * from './custody-settings-response.dto';
