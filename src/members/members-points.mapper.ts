import {
  MemberBeansLogResponseDto,
  MemberPointsLogResponseDto,
  type MemberBeanRecordSourceValue,
  type MemberBeanRecordTypeValue,
  type MemberPointsRecordSourceValue,
  type MemberPointsRecordTypeValue,
} from './dto/adjust-member-points.dto';

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

function resolvePointsRecordType(
  log: MemberPointsLogRecord,
): MemberPointsRecordTypeValue {
  if (log.source === 'expire') {
    return 'expire';
  }

  return log.amount > 0 ? 'earn' : 'spend';
}

function resolveBeanRecordType(
  log: MemberBeanLogRecord,
): MemberBeanRecordTypeValue {
  if (log.source === 'withdrawal') {
    return 'withdraw';
  }

  return log.amount > 0 ? 'earn' : 'spend';
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
