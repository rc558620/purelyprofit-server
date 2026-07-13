import type {
  MemberBeanRecordSourceValue,
  MemberBeanRecordTypeValue,
} from './dto/member-beans.dto';
import type {
  MemberPointsRecordSourceValue,
  MemberPointsRecordTypeValue,
} from './dto/member-points.dto';
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

const POINTS_INSUFFICIENT_MESSAGE = '会员当前积分不足，无法扣减';
const POINTS_MISSING_CUSTOMER_MESSAGE =
  '该会员尚未关联营销顾客档案，无法调整积分；请先在门店关联顾客档案';
const BEANS_INSUFFICIENT_MESSAGE = '会员当前纯利豆不足，无法扣减';

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
  insufficientMessage: POINTS_INSUFFICIENT_MESSAGE,
  // 积分事实源为 marketing_customers，要求会员必须已关联顾客档案
  requiresCustomer: true,
  missingCustomerMessage: POINTS_MISSING_CUSTOMER_MESSAGE,
  buildApplyInput: ({
    member,
    operatorStaffId,
    delta,
    reason,
    expireAt,
  }: ResolvedMemberAssetAdjustment) => ({
    member,
    operatorStaffId,
    delta,
    reason,
    insufficientMessage: POINTS_INSUFFICIENT_MESSAGE,
    expireAt: expireAt ?? null,
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
  insufficientMessage: BEANS_INSUFFICIENT_MESSAGE,
  // 纯利豆保留在 Member 表，不依赖营销顾客档案
  requiresCustomer: false,
  missingCustomerMessage: '',
  buildApplyInput: ({
    member,
    operatorStaffId,
    delta,
    reason,
  }: ResolvedMemberAssetAdjustment) => ({
    member,
    operatorStaffId,
    delta,
    reason,
    insufficientMessage: BEANS_INSUFFICIENT_MESSAGE,
  }),
  apply: applyMemberBeansAdjustment,
};
