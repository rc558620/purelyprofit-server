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

/**
 * 门店快照缓存载荷：角色判定（ownerId）与推送载荷（name）都要用。
 *
 * 两者都是低频变更的门店级数据，合成一份缓存可让读链路与推送链路共用。
 */
export interface CustodyStoreSnapshot {
  /** 门店主账号的登录用户 ID：主账号身份的权威依据 */
  ownerId: number | null;
  /** 门店名：推送给会员时指明是哪家门店 */
  name: string;
}
