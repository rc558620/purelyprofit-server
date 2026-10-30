import type { StoreWechatPayBindStatus } from '@prisma/client';

/** 门店微信收款配置的读取结果（含绑定校验状态），供服务间传递与响应映射复用 */
export type WechatPayConfigRecord = {
  mchId: string;
  mchName: string;
  apiV3KeyEnc: string;
  /** 子商户号（sub_mchid）：服务商模式下的资金去向，直连模式下与 mchId 同值（迁移已回填） */
  subMchId: string | null;
  /** 子商户与服务商的绑定校验状态：pending / verified / failed */
  bindStatus: StoreWechatPayBindStatus;
  /** 最近一次绑定校验时间 */
  bindCheckedAt: Date | null;
  /** 最近一次校验失败原因（中文，可直接展示给商家） */
  bindFailReason: string | null;
  configuredAt: Date;
};

/** 服务商模式下「已配置」的判定状态：只有校验通过才算真正可以收款 */
export const BIND_STATUS_VERIFIED: StoreWechatPayBindStatus = 'verified';
