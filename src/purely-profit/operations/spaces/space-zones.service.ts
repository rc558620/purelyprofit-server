import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toTimestampMs } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildSpaceZonesCacheKey,
} from '../../../redis/cache-keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { RedisService } from '../../../redis/redis.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
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
 * 空间区域列表缓存策略（与空间类型同源同模式）。
 *
 * 低频变更的门店运营配置，命中缓存后 GET /space-zones 从「鉴权缓存 + 2 次 DB」
 * 降为「鉴权缓存 + 0 次 DB」。TTL 只兜底，一致性由写路径
 * invalidateSpaceZonesCache 主动失效保证。
 */
const SPACE_ZONES_CACHE_TTL_SECONDS = 60;
/** 提前刷新窗口：超过 20s 的命中由后台刷新，避免多端在同一秒集体回源 */
const SPACE_ZONES_CACHE_REFRESH_AFTER_MS = 20_000;

@Injectable()
export class SpaceZonesService {
  private readonly logger = new Logger(SpaceZonesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly redisService: RedisService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
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
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SPACE_ZONES_CACHE_TTL_SECONDS,
      refreshAfterMs: SPACE_ZONES_CACHE_REFRESH_AFTER_MS,
      loadValue: () => this.loadSpaceZones(storeId),
    });
  }

  private async loadSpaceZones(
    storeId: number,
  ): Promise<SpaceZoneResponseDto[]> {
    const items = await this.prisma.spaceZone.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceZoneResponse(item));
  }

  /**
   * 失效门店空间区域列表缓存。
   * 由 create / update / delete 写路径在提交成功后调用。
   *
   * 区域列表只有一个确定 key，直接精确删除；delByPattern 即使模式不含通配符
   * 也会走 SCAN 遍历键空间。
   */
  private async invalidateSpaceZonesCache(storeId: number): Promise<void> {
    await this.redisService.del(buildSpaceZonesCacheKey(storeId));
  }

  /**
   * 写路径已落库后的缓存失效：失败只记录告警，不能把已提交的写操作报成失败。
   * 残余旧值由 TTL 与提前刷新窗口兜底，用户重试也不会再撞「已存在 / 不存在」。
   */
  private async invalidateSpaceZonesCacheQuietly(
    storeId: number,
  ): Promise<void> {
    try {
      await this.invalidateSpaceZonesCache(storeId);
    } catch (error) {
      this.logger.warn(
        `空间区域缓存失效失败 storeId=${storeId}: ${this.describeError(error)}`,
      );
    }
  }

  /** 空间列表 / 看板缓存内嵌 zone.name 快照，改名后必须同步失效；失败不阻断写入。 */
  private async invalidateSpacesReadCachesQuietly(
    storeId: number,
  ): Promise<void> {
    try {
      await this.cacheInvalidatorService.invalidateSpacesReadCaches(storeId);
    } catch (error) {
      this.logger.warn(
        `空间读缓存失效失败 storeId=${storeId}: ${this.describeError(error)}`,
      );
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : '未知错误';
  }

  /**
   * 唯一约束冲突统一归一化为 409。
   * 新增与改名共用，避免只修一处导致并发时另一处透传 500。
   */
  private throwIfZoneNameConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('空间区域名称已存在');
    }
    throw error;
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
      this.throwIfZoneNameConflict(err);
    }

    await this.invalidateSpaceZonesCacheQuietly(storeId);

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

    let updated;
    try {
      updated = await this.prisma.spaceZone.update({
        where: { id: item.id },
        data: { name },
      });
    } catch (err) {
      // 写入前查重挡不住并发改名：另一个请求抢先提交同名后，
      // 这里的 update 会撞 @@unique([storeId, name])，必须与新增一样归一化为 409。
      this.throwIfZoneNameConflict(err);
    }

    await this.invalidateSpaceZonesCacheQuietly(item.storeId);

    // 空间列表 / 看板缓存内嵌 zone.name 快照：只清区域自身缓存不够，
    // 区域改名后必须同步失效空间读缓存，否则看板仍展示旧区域名直到列表 TTL 过期。
    await this.invalidateSpacesReadCachesQuietly(item.storeId);

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
      select: { id: true, storeId: true },
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

    /*
     * 引用检查与删除必须在同一事务内，并先对区域行加排他锁。
     * 否则「查引用数 → 另一请求把空间绑到该区域 → 删除」时，
     * ON DELETE SET NULL 会把刚绑定的 zoneId 静默清空。
     * 空间绑定需要父行 KEY SHARE 锁，会被这里的 FOR UPDATE 挡在删除之后，
     * 竞态最终表现为一次明确的外键失败，而不是无声解绑。
     * 引用统计包含软删除空间（B-5），与旧行为保持一致。
     */
    await this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM space_zones WHERE id = ${item.id} FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new NotFoundException('空间区域不存在');
      }

      const referencing = await transaction.space.findFirst({
        where: { zoneId: item.id },
        select: { id: true },
      });

      if (referencing) {
        throw new ConflictException('该空间区域仍被空间引用，无法删除');
      }

      await transaction.spaceZone.delete({ where: { id: item.id } });
    });

    await this.invalidateSpaceZonesCacheQuietly(item.storeId);
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
