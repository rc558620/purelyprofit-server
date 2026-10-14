import type { MembershipPlanCycle } from '@prisma/client';
import type { PulseAdminMemberRecordChannelValue } from './dto/pulse-membership-admin-member-records.shared.dto';
import type { MemberRecordCursor } from './membership-admin-member-records.cursor';

/**
 * createdAt 过滤片段：三张表的查询条件只用 gte / lte 两个键。
 *
 * 刻意用结构子集而非 Prisma 生成的模型级 WhereInput —— 后者跟随
 * `prisma generate` 的时序，schema 新增了模型而 client 未重新生成时
 * 会解析成 error type（等同 any），类型保护整条失效。
 * 结构子集 spread 进 where 后，仍由 Prisma 的参数类型做结构校验。
 */
export interface MemberRecordCreatedAtWhere {
  createdAt: {
    gte?: Date;
    lte?: Date;
  };
}

/** 排序前的统一行形态：四类原始记录先拍平到这里，再统一排序与映射。 */
export interface MemberRecordRow extends MemberRecordCursor {
  storeId: number;
  /** 改价审计只存 planId，档位名由套餐目录补全；其余类型直接用行内名称。 */
  planId: MembershipPlanCycle | null;
  planName: string;
  amountDisplay: string | null;
  pointsAwarded: number;
  channel: PulseAdminMemberRecordChannelValue | null;
  /** 子账号审计只有 operatorUserId，名字在捞到行之后批量补。 */
  operatorUserId: number | null;
  operatorName: string | null;
  oldValueDisplay: string | null;
  newValueDisplay: string | null;
  reason: string | null;
}
