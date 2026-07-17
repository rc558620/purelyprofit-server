import { ConflictException } from '@nestjs/common';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import { PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT } from './dto/pulse-membership-admin-logs.shared.dto';

type AdminMemberLogsCursor = {
  createdAt: Date;
  id: number;
};

type AdminMemberLogsCursorPagination = {
  cursor?: AdminMemberLogsCursor;
  limit?: number;
};

export function resolveAdminMemberLogsCursorPagination(
  query: GetPulseAdminMemberLogsQueryDto,
): AdminMemberLogsCursorPagination {
  if (query.cursor === undefined && query.limit === undefined) {
    return {};
  }

  if (query.cursor === undefined) {
    return {
      limit: query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT,
    };
  }

  const cursor = parseAdminMemberLogsCursor(query.cursor);
  if (!cursor) {
    throw new ConflictException('cursor 格式不合法');
  }

  return {
    cursor,
    limit: query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT,
  };
}

export function encodeAdminMemberLogsCursor(
  log: Pick<AdminMemberLogsCursor, 'createdAt' | 'id'> | null,
): string | null {
  if (!log) {
    return null;
  }

  return `${log.createdAt.getTime()}_${log.id}`;
}

function parseAdminMemberLogsCursor(
  cursor: string,
): AdminMemberLogsCursor | null {
  const match = /^(\d+)_(\d+)$/.exec(cursor);
  if (!match) {
    return null;
  }

  const [, rawCreatedAt, rawId] = match;
  const createdAtMs = Number(rawCreatedAt);
  const id = Number(rawId);
  if (
    !Number.isSafeInteger(createdAtMs) ||
    !Number.isSafeInteger(id) ||
    createdAtMs <= 0 ||
    id <= 0
  ) {
    return null;
  }

  return {
    createdAt: new Date(createdAtMs),
    id,
  };
}
