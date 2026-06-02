import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { SpaceSessionListQuery } from './space-sessions.types';

export const buildSpaceSessionListWhere = (
  spaceId: number,
  query: SpaceSessionListQuery,
): Prisma.SpaceSessionWhereInput => {
  const conditions: Prisma.SpaceSessionWhereInput[] = [{ spaceId }];

  if (query.status) {
    conditions.push({ status: query.status });
  } else if (query.includeActive !== true) {
    conditions.push({ status: PrismaSpaceSessionStatus.settled });
  }

  if (query.keyword) {
    conditions.push({
      OR: [
        { guestName: { contains: query.keyword, mode: 'insensitive' } },
        { guestPhone: { contains: query.keyword } },
      ],
    });
  }

  const timeRangeCondition = buildSpaceSessionTimeRangeWhere(
    query.rangeStartDate,
    query.rangeEndDate,
  );
  if (timeRangeCondition) {
    conditions.push(timeRangeCondition);
  }

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
};

export const buildStoreSpaceSessionListWhere = (
  storeId: number,
  query: SpaceSessionListQuery,
): Prisma.SpaceSessionWhereInput => {
  const conditions: Prisma.SpaceSessionWhereInput[] = [{ storeId }];

  if (query.status) {
    conditions.push({ status: query.status });
  } else if (query.includeActive !== true) {
    conditions.push({ status: PrismaSpaceSessionStatus.settled });
  }

  if (query.keyword) {
    conditions.push({
      OR: [
        { guestName: { contains: query.keyword, mode: 'insensitive' } },
        { guestPhone: { contains: query.keyword } },
        { space: { name: { contains: query.keyword, mode: 'insensitive' } } },
      ],
    });
  }

  const timeRangeCondition = buildSpaceSessionTimeRangeWhere(
    query.rangeStartDate,
    query.rangeEndDate,
  );
  if (timeRangeCondition) {
    conditions.push(timeRangeCondition);
  }

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
};

const buildSpaceSessionTimeRangeWhere = (
  rangeStartDate?: number,
  rangeEndDate?: number,
): Prisma.SpaceSessionWhereInput | undefined => {
  if (rangeStartDate === undefined && rangeEndDate === undefined) {
    return undefined;
  }

  if (
    rangeStartDate !== undefined &&
    rangeEndDate !== undefined &&
    rangeStartDate > rangeEndDate
  ) {
    throw new BadRequestException('区间开始时间不能晚于结束时间');
  }

  const conditions: Prisma.SpaceSessionWhereInput[] = [];

  if (rangeEndDate !== undefined) {
    conditions.push({
      startTime: {
        lte: new Date(rangeEndDate),
      },
    });
  }

  if (rangeStartDate !== undefined) {
    conditions.push({
      OR: [
        {
          endTime: {
            gte: new Date(rangeStartDate),
          },
        },
        {
          endTime: null,
        },
      ],
    });
  }

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
};
