// 客存验证码 Redis 载荷类型：取件码与核销预留令牌在 Redis 中存储的结构
/** 取件码载荷：定位可被核销的在存存单 */
export interface CustodyPickupCodePayload {
  /** 客存单主键 */
  custodyOrderId: number;
  /** 门店 ID（防跨店核销） */
  storeId: number;
}

/** 核销预留令牌载荷：取件码校验成功后签发，供确认取出阶段消费 */
export interface CustodyVerifyTokenPayload {
  /** 客存单主键 */
  custodyOrderId: number;
  /** 门店 ID */
  storeId: number;
  /** 原始取件码（便于失败时清理残留码） */
  pickupCode: string;
}

/** 短码签发结果 */
export interface IssuedShortCode {
  /** 短码值 */
  code: string;
  /** 过期时间（ISO 字符串，UTC） */
  expiresAt: string;
}
