import type { MembershipRuntimeLevel } from './platform-membership-access.shared';

export interface StoreDowngradeState {
  /**
   * 是否为「曾经开通过会员、现已过期」的降级态。
   *
   * ⚠️ 必须区分于「从未开通过」：两者当前档位都是 free，但从未开通的门店
   * 属于免费版正常用户，不能施加到期专属限制（C 端停新单、追加点单禁用、
   * 手动录单限额），否则会误伤全部免费商家。
   */
  isExpired: boolean;
  /** 当前生效档位 */
  level: MembershipRuntimeLevel;
  /** 到期时间戳（ms），从未开通时为 null */
  expiredAt: number | null;
  /** 剩余天数，从未开通时为 0 */
  remainingDays: number;
}

/** 手动录单当日用量 */
export interface ManualEntryUsage {
  used: number;
  limit: number;
}
