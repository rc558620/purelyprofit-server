/**
 * 营销商品 DTO 统一出口。
 *
 * 为控制单文件行数，已按用途拆分：
 * - `marketing-product-create.dto.ts`：创建营销产品入参
 * - `marketing-product-update.dto.ts`：更新营销产品入参
 *
 * 对外仍从此文件导出，避免影响既有引用路径。
 */
export * from './marketing-product-create.dto';
export * from './marketing-product-update.dto';
