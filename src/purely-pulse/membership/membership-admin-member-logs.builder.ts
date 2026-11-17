import type {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import {
  resolveAdminMemberDisplayName,
  resolveAdminMemberPhone,
} from './membership-admin-query.helper';
import type { PulseAdminStoreIdentityRecord } from './membership.types';

/**
 * 会员积分 / 纯利豆流水的行 → DTO 映射。
 *
 * 与 `membership-admin-member.builder`（列表 / 详情）分开：流水在两个 Tab 里
 * 独立分页，改它的字段口径不影响会员主体展示。
 */

type PulseAdminLogStoreRecord = Pick<
  PulseAdminStoreIdentityRecord,
  'name' | 'contactPhone' | 'owner'
>;

type PulseAdminLogOwnerRecord = {
  email: string | null;
  name: string | null;
  realName: string | null;
  avatar: string | null;
  wechatPhone: string | null;
};

type PulseAdminPointsLogRecord = {
  id: number;
  storeId: number;
  source:
    | 'purchase_bonus'
    | 'deduct_payment'
    | 'admin_adjust'
    | 'expire'
    | 'check_in';
  changeType: 'increase' | 'decrease';
  changeAmount: number;
  description: string;
  expireAt: Date | null;
  createdAt: Date;
  store: PulseAdminLogStoreRecord & { owner: PulseAdminLogOwnerRecord };
};

type PulseAdminBeanLogRecord = {
  id: number;
  storeId: number;
  source: 'promo_reward' | 'deduct_payment' | 'withdrawal' | 'admin_adjust';
  changeAmount: number;
  description: string;
  relatedPromoRecordId: number | null;
  relatedUser: string | null;
  createdAt: Date;
  store: PulseAdminLogStoreRecord & { owner: PulseAdminLogOwnerRecord };
};

export function buildPulseAdminPointsLogItem(
  log: PulseAdminPointsLogRecord,
): PulseAdminMemberPointsLogsResponseDto['items'][number] {
  const userName = resolveAdminMemberDisplayName(log.store);
  const userPhone = resolveAdminMemberPhone(log.store);

  const signedAmount =
    log.changeType === 'decrease' ? -log.changeAmount : log.changeAmount;

  return {
    id: String(log.id),
    userId: String(log.storeId),
    userName,
    userPhone,
    avatarUrl: log.store.owner.avatar ?? undefined,
    amount: signedAmount,
    type:
      log.source === 'expire'
        ? 'expire'
        : log.changeType === 'increase'
          ? 'earn'
          : 'spend',
    source: log.source,
    description: log.description,
    createdAt: log.createdAt.getTime(),
    expireAt: log.expireAt ? log.expireAt.getTime() : null,
  };
}

export function buildPulseAdminBeanLogItem(
  log: PulseAdminBeanLogRecord,
): PulseAdminMemberBeanLogsResponseDto['items'][number] {
  const userName = resolveAdminMemberDisplayName(log.store);
  const userPhone = resolveAdminMemberPhone(log.store);

  return {
    id: String(log.id),
    userId: String(log.storeId),
    userName,
    userPhone,
    avatarUrl: log.store.owner.avatar ?? undefined,
    amount: log.changeAmount,
    type:
      log.source === 'withdrawal'
        ? 'withdraw'
        : log.changeAmount > 0
          ? 'earn'
          : 'spend',
    source: log.source,
    description: log.description,
    relatedPromoId: log.relatedPromoRecordId
      ? String(log.relatedPromoRecordId)
      : undefined,
    relatedUser: log.relatedUser ?? undefined,
    createdAt: log.createdAt.getTime(),
  };
}
