/**
 * 扫码点餐桌码对外返回的形态。
 *
 * 单独成文件的原因：列表 / 导出 / 建码结果会被 `table.types.ts`、`table.controller.ts`
 * 引用，放在 service 文件里会让「用类型」反向依赖「用实现」。
 */

/** 桌台二维码创建结果，明文 token 仅在本次创建响应返回。 */
export interface ScanOrderingQrCodeResponse {
  /** 二维码记录主键。 */
  id: number;
  /** 桌台主键。 */
  tableId: number;
  /** 桌码版本。 */
  version: number;
  /** 仅本次响应返回的不可枚举扫码 token。 */
  token: string;
  /** 二维码图片 Data URL（base64 PNG），可直接用于前端<img>标签。 */
  qrCodeImageUrl: string;
}

/** 桌码列表项（同一桌台的历史版本，倒序）。 */
export interface ScanOrderingQrCodeListItem {
  /** 二维码记录主键。 */
  id: number;
  /** 桌码版本。 */
  version: number;
  /** 桌码状态：active / revoked。 */
  status: string;
  /** 创建时间（ISO 8601）。 */
  createdAt: string;
  /** 作废时间（ISO 8601），未作废为 null。 */
  revokedAt: string | null;
}

/** 桌码导出项：按「桌台 + 桌码版本」铺平，供商家端批量导出。 */
export interface ScanOrderingQrCodeExportItem {
  /** 桌台主键。 */
  tableId: number;
  /** 桌台编号。 */
  tableCode: string;
  /** 桌台名称。 */
  tableName: string;
  /** 桌码版本。 */
  qrCodeVersion: number;
  /** 桌码状态：active / revoked。 */
  qrCodeStatus: string;
}
