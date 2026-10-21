import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toTimestampMs } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildSpaceZonesCacheKey,
  buildSpaceZonesPattern,
} from '../../../redis/cache-keys';
import { RedisService } from '../../../redis/redis.service';
import {
  CreateSpaceZoneDto,
  ListSpaceZonesQueryDto,
  type SpaceZoneResponseDto,
  UpdateSpaceZoneDto,
} from './dto/space-zone.dto';
import { ensurePrimaryAccountOnly } from './spaces.shared';

interface SpaceZoneRecord {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 空间区域列表缓存 TTL（秒）。
 *
 * 与空间类型同源策略：低频变更的门店运营配置，命中缓存后
 * GET /space-zones 从「6 次 Redis + 2 次 DB」降为「6 次 Redis + 0 次 DB」。
 * TTL 只兜底，一致性由写路径主动失效保证。
 */
const SPACE_ZONES_CACHE_TTL_SECONDS = 60;

@Injectable()
export class SpaceZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly redisService: RedisService,
  ) {}

  async listSpaceZones(
    user: AuthenticatedUser,
    query: ListSpaceZonesQueryDto,
  ): Promise<SpaceZoneResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间区域',
    );

    if (storeId === null) {
      return [];
    }

    const cacheKey = buildSpaceZonesCacheKey(storeId);
    const cached =
      await this.redisService.getJson<SpaceZoneResponseDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const items = await this.prisma.spaceZone.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const response = items.map((item) => this.toSpaceZoneResponse(item));

    // 一致性边界：load 与写回之间若发生写请求（写路径提交后按 key 失效），
    // 本次 load 读到的旧值仍会被写回并存活一个 TTL，属于有界陈旧。
    // 空间区域为运营配置、写路径极低频，该窗口可接受。
    await this.redisService.setJson(
      cacheKey,
      response,
      SPACE_ZONES_CACHE_TTL_SECONDS,
    );

    return response;
  }

  /**
   * 失效门店空间区域列表缓存。
   * 由 create / update / delete 写路径在提交成功后调用。
   */
  private async invalidateSpaceZonesCache(storeId: number): Promise<void> {
    await this.redisService.delByPattern(buildSpaceZonesPattern(storeId));
  }

  async createSpaceZone(
    user: AuthenticatedUser,
    dto: CreateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    // 空间区域配置属于门店运营配置，仅允许主账号操作，子账号均被拒绝。
    ensurePrimaryAccountOnly(user, '空间区域');
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'space:create',
      '无权操作该门店空间区域',
    );
    const name = dto.name.trim();

    const duplicate = await this.prisma.spaceZone.findFirst({
      where: { storeId, name },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('空间区域名称已存在');
    }

    let item;
    try {
      item = await this.prisma.spaceZone.create({
        data: { storeId, name },
      });
    } catch (err) {
      // BUG-01 fix: 并发创建同名区域触发 @@unique([storeId, name]) 约束，
      // 将 Prisma P2002 归一化为业务友好的 409 ConflictException
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('空间区域名称已存在');
      }
      throw err;
    }

    await this.invalidateSpaceZonesCache(storeId);

    return this.toSpaceZoneResponse(item);
  }

  async updateSpaceZone(
    user: AuthenticatedUser,
    zoneId: number,
    dto: UpdateSpaceZoneDto,
  ): Promise<SpaceZoneResponseDto> {
    // 空间区域配置写操作仅允许主账号，子账号均被拒绝（同 createSpaceZone）。
    ensurePrimaryAccountOnly(user, '空间区域');
    const item = await this.prisma.spaceZone.findUnique({
      where: { id: zoneId },
    });

    if (!item) {
      throw new NotFoundException('空间区域不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:update',
      '无权操作该门店空间区域',
    );

    const name = dto.name.trim();
    if (name !== item.name) {
      const duplicate = await this.prisma.spaceZone.findFirst({
        where: {
          storeId: item.storeId,
          name,
          id: { not: item.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException('空间区域名称已存在');
      }
    }

    const updated = await this.prisma.spaceZone.update({
      where: { id: item.id },
      data: { name },
    });

    await this.invalidateSpaceZonesCache(item.storeId);

    return this.toSpaceZoneResponse(updated);
  }

  async resolveSpaceZoneByName(
    storeId: number,
    rawName: string | undefined,
  ): Promise<{ id: number; name: string } | null> {
    const name = rawName?.trim();
    if (!name) {
      return null;
    }

    const zone = await this.prisma.spaceZone.findFirst({
      where: { storeId, name },
      select: {
        id: true,
        name: true,
      },
    });

    if (!zone) {
      // BUG-06 fix: 引用字段不存在应返回 400（请求体参数无效），而非 404（资源不存在）
      throw new BadRequestException(
        `空间区域「${name}」不存在，请先通过 POST /space-zones 创建`,
      );
    }

    return zone;
  }

  async removeSpaceZone(
    user: AuthenticatedUser,
    zoneId: number,
  ): Promise<void> {
    // 空间区域配置写操作仅允许主账号，子账号均被拒绝（同 createSpaceZone）。
    ensurePrimaryAccountOnly(user, '空间区域');
    const item = await this.prisma.spaceZone.findUnique({
      where: { id: zoneId },
      select: {
        id: true,
        storeId: true,
        _count: {
          // B-5 fix: 统计所有空间引用（含软删除），
          // 避免物理删除区域时 SetNull 清空软删除空间的 zoneId 导致审计数据丢失
          select: { spaces: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('空间区域不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:delete',
      '无权删除该门店空间区域',
    );

    if (item._count.spaces > 0) {
      throw new ConflictException('该空间区域仍被空间引用，无法删除');
    }

    await this.prisma.spaceZone.delete({
      where: { id: item.id },
    });

    await this.invalidateSpaceZonesCache(item.storeId);
  }

  toSpaceZoneResponse(item: SpaceZoneRecord): SpaceZoneResponseDto {
    return {
      id: String(item.id),
      name: item.name,
      createdAt: toTimestampMs(item.createdAt),
      updatedAt: toTimestampMs(item.updatedAt),
    };
  }
}
