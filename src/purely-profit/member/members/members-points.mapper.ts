import {
  MemberBeansLogResponseDto,
} from './dto/member-beans.dto';
import type {
  MemberBeanRecordSourceValue,
  MemberBeanRecordTypeValue,
} from './dto/member-beans.dto';
import {
  MemberPointsLogResponseDto,
} from './dto/member-points.dto';
import type {
  MemberPointsRecordSourceValue,
  MemberPointsRecordTypeValue,
} from './dto/member-points.dto';

export interface MemberPointsLogRecord {
  id: number;
  memberId: number;
  memberName: string;
  memberPhone: string | null;
  amount: number;
  source: MemberPointsRecordSourceValue;
  description: string;
  createdAt: Date;
  expireAt?: Date | null;
}

export interface MemberBeanLogRecord {
  id: number;
  memberId: number;
  memberName: string;
  memberPhone: string | null;
  amount: number;
  source: MemberBeanRecordSourceValue;
  description: string;
  relatedPromoId?: string | null;
  relatedUser?: string | null;
  createdAt: Date;
}

const POINTS_EARN_RECORD_TYPE: MemberPointsRecordTypeValue = 'earn';
const POINTS_SPEND_RECORD_TYPE: MemberPointsRecordTypeValue = 'spend';
const POINTS_EXPIRE_RECORD_TYPE: MemberPointsRecordTypeValue = 'expire';
const BEAN_EARN_RECORD_TYPE: MemberBeanRecordTypeValue = 'earn';
const BEAN_SPEND_RECORD_TYPE: MemberBeanRecordTypeValue = 'spend';
const BEAN_WITHDRAW_RECORD_TYPE: MemberBeanRecordTypeValue = 'withdraw';

function resolvePointsRecordType(
  log: MemberPointsLogRecord,
): MemberPointsRecordTypeValue {
  if (log.source === 'expire') {
    return POINTS_EXPIRE_RECORD_TYPE;
  }

  return log.amount > 0 ? POINTS_EARN_RECORD_TYPE : POINTS_SPEND_RECORD_TYPE;
}

function resolveBeanRecordType(
  log: MemberBeanLogRecord,
): MemberBeanRecordTypeValue {
  if (log.source === 'withdrawal') {
    return BEAN_WITHDRAW_RECORD_TYPE;
  }

  return log.amount > 0 ? BEAN_EARN_RECORD_TYPE : BEAN_SPEND_RECORD_TYPE;
}

export function toMemberPointsLogResponse(
  log: MemberPointsLogRecord,
): MemberPointsLogResponseDto {
  const response: MemberPointsLogResponseDto = {
    id: `pts-${log.id}`,
    userId: String(log.memberId),
    userName: log.memberName,
    userPhone: log.memberPhone ?? '',
    amount: log.amount,
    type: resolvePointsRecordType(log),
    source: log.source,
    description: log.description,
    createdAt: log.createdAt.getTime(),
  };

  if (log.expireAt) {
    response.expireAt = log.expireAt.getTime();
  }

  return response;
}

export function toMemberBeansLogResponse(
  log: MemberBeanLogRecord,
): MemberBeansLogResponseDto {
  const response: MemberBeansLogResponseDto = {
    id: `bean-${log.id}`,
    userId: String(log.memberId),
    userName: log.memberName,
    userPhone: log.memberPhone ?? '',
    amount: log.amount,
    type: resolveBeanRecordType(log),
    source: log.source,
    description: log.description,
    createdAt: log.createdAt.getTime(),
  };

  if (log.relatedPromoId) {
    response.relatedPromoId = log.relatedPromoId;
  }

  if (log.relatedUser) {
    response.relatedUser = log.relatedUser;
  }

  return response;
}
