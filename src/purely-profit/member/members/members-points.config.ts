import type {
  MemberBeanRecordSourceValue,
  MemberBeanRecordTypeValue,
} from './dto/member-beans.dto';
import type {
  MemberPointsRecordSourceValue,
  MemberPointsRecordTypeValue,
} from './dto/member-points.dto';
import type { MemberRecord } from './members.mapper';
import {
  toMemberBeansLogResponse,
  toMemberPointsLogResponse,
} from './members-points.mapper';
import {
  applyMemberBeansAdjustment,
  applyMemberPointsAdjustment,
  queryMemberBeanLogs,
  queryMemberBeansOverview,
  queryMemberPointsLogs,
  queryMemberPointsOverview,
} from './members-points.query';
import type {
  MemberBeansOverviewRow,
  MemberPointsOverviewRow,
  ResolvedMemberAssetAdjustment,
} from './members.types';
import type { MemberAssetServiceConfig } from './members-points.shared';

type PointsLogRecord = Parameters<typeof toMemberPointsLogResponse>[0];
type PointsLogResponse = ReturnType<typeof toMemberPointsLogResponse>;
type BeansLogRecord = Parameters<typeof toMemberBeansLogResponse>[0];
type BeansLogResponse = ReturnType<typeof toMemberBeansLogResponse>;

export const POINTS_MEMBER_ASSET_CONFIG: MemberAssetServiceConfig<
  MemberPointsOverviewRow,
  MemberPointsRecordTypeValue,
  MemberPointsRecordSourceValue,
  PointsLogRecord,
  PointsLogResponse,
  Parameters<typeof applyMemberPointsAdjustment>[1]
> = {
  overviewForbiddenMessage: '无权查看该门店积分记录概览',
  logsForbiddenMessage: '无权查看该门店积分记录',
  emptyOverview: {
    totalCount: 0,
    adminAdjustCount: 0,
    todayChangeCount: 0,
  },
  overviewQuery: queryMemberPointsOverview,
  logsQuery: queryMemberPointsLogs,
  mapLog: toMemberPointsLogResponse,
  assetLabel: '积分',
  insufficientMessage: '会员当前积分不足，无法扣减',
  // 积分现在从 MarketingCustomer（事实源）读取
  getCurrentValue: (member: MemberRecord) => member.customer?.points ?? 0,
  buildApplyInput: ({
    member,
    operatorStaffId,
    delta,
    reason,
    beforeValue,
    afterValue,
  }: ResolvedMemberAssetAdjustment) => ({
    member,
    operatorStaffId,
    delta,
    reason,
    beforePoints: beforeValue,
    afterPoints: afterValue,
  }),
  apply: applyMemberPointsAdjustment,
};

export const BEANS_MEMBER_ASSET_CONFIG: MemberAssetServiceConfig<
  MemberBeansOverviewRow,
  MemberBeanRecordTypeValue,
  MemberBeanRecordSourceValue,
  BeansLogRecord,
  BeansLogResponse,
  Parameters<typeof applyMemberBeansAdjustment>[1]
> = {
  overviewForbiddenMessage: '无权查看该门店纯利豆记录概览',
  logsForbiddenMessage: '无权查看该门店纯利豆记录',
  emptyOverview: {
    totalCount: 0,
    adminAdjustCount: 0,
    promoRewardCount: 0,
    withdrawCount: 0,
  },
  overviewQuery: queryMemberBeansOverview,
  logsQuery: queryMemberBeanLogs,
  mapLog: toMemberBeansLogResponse,
  assetLabel: '纯利豆',
  insufficientMessage: '会员当前纯利豆不足，无法扣减',
  // 纯利豆仍保留在 Member（独立于营销积分）
  getCurrentValue: (member: MemberRecord) => member.beanBalance,
  buildApplyInput: ({
    member,
    operatorStaffId,
    delta,
    reason,
    beforeValue,
    afterValue,
  }: ResolvedMemberAssetAdjustment) => ({
    member,
    operatorStaffId,
    delta,
    reason,
    beforeBalance: beforeValue,
    afterBalance: afterValue,
  }),
  apply: applyMemberBeansAdjustment,
};
