/**
 * 门店微信收款「是否已完成配置」的唯一判定口径。
 *
 * 历史上设置页与营销概览各写一套，导致同一门店在两处显示相反结论：
 * 设置页要求「子商户号 + 绑定校验通过」，营销概览只看「有商户号 + 有配置时间」，
 * 于是保存后未校验（甚至校验失败）的门店会被营销中心标成「已配置」。
 * 这类静默故障直接关联资金链路，判定逻辑必须收敛到一处，禁止各模块自行拼条件。
 */

/** 判定所需的最小配置字段集：调用方只需查询这几列，不依赖具体 Prisma model。 */
export interface WechatPayConfigStatusSource {
  /** 直连模式商户号；服务商模式下等同旧字段，仅作灰度回落 */
  mchId: string | null;
  /** 直连模式 APIv3 密钥密文；服务商模式下为空 */
  apiV3KeyEnc: string | null;
  /** 服务商模式子商户号（决定资金结算去向） */
  subMchId: string | null;
  /** 子商户与服务商的绑定校验状态：pending / verified / failed */
  bindStatus: string | null;
}

/**
 * 是否已完成收款配置（等价于「可以真正收款」）。
 *
 * - 服务商模式：必须有子商户号，且绑定关系校验通过（verified）。
 *   只保存未校验、校验失败、结果未知都不算配置完成。
 * - 直连模式（旧链路）：维持原口径，商户号 + APIv3 密钥均存在。
 *
 * @param isPartnerMode 由调用方从 ConfigService 读取后传入，避免工具层反向依赖配置模块。
 */
export function isWechatPayConfigured(
  source: WechatPayConfigStatusSource,
  isPartnerMode: boolean,
): boolean {
  return isPartnerMode
    ? Boolean(source.subMchId) && source.bindStatus === 'verified'
    : Boolean(source.mchId && source.apiV3KeyEnc);
}
