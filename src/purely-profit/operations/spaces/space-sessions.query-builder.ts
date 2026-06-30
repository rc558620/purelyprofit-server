import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { SpaceSessionListQuery } from './space-sessions.types';

/**
 * 构建空间维度的搜索条件。
 * - 优先使用独立字段（guestName / guestPhone），精确控制搜索路径
 * - keyword 降级为向后兼容的联合搜索
 */
const buildKeywordSearchConditions = (
  query: SpaceSessionListQuery,
  includeSpaceName: boolean,
): Prisma.SpaceSessionWhereInput[] => {
  const searchConditions: Prisma.SpaceSessionWhereInput[] = [];

  // 独立字段优先
  if (query.guestName) {
    searchConditions.push({
      guestName: { contains: query.guestName, mode: 'insensitive' },
    });
  }
  if (query.guestPhone) {
    searchConditions.push({
      guestPhone: { startsWith: query.guestPhone },
    });
  }
  if (includeSpaceName && query.spaceName) {
    searchConditions.push({
      space: { name: { contains: query.spaceName, mode: 'insensitive' } },
    });
  }

  // 仅在没有任何独立搜索字段时，才使用 keyword 联合搜索（向后兼容）
  if (searchConditions.length === 0 && query.keyword) {
    const orConditions: Prisma.SpaceSessionWhereInput[] = [
      { guestName: { contains: query.keyword, mode: 'insensitive' } },
      { guestPhone: { startsWith: query.keyword } },
    ];
    if (includeSpaceName) {
      orConditions.push({
        space: { name: { contains: query.keyword, mode: 'insensitive' } },
      });
    }
    searchConditions.push({ OR: orConditions });
  }

  return searchConditions;
};

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

  // 空间维度不支持 spaceName 搜索
  const searchConditions = buildKeywordSearchConditions(query, false);
  conditions.push(...searchConditions);

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

  // 门店维度支持 spaceName 搜索
  const searchConditions = buildKeywordSearchConditions(query, true);
  conditions.push(...searchConditions);

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
