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
  buildSpaceTypesCacheKey,
} from '../../../redis/cache-keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { RedisService } from '../../../redis/redis.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import {
  CreateSpaceTypeDto,
  ListSpaceTypesQueryDto,
  type SpaceTypeResponseDto,
  UpdateSpaceTypeDto,
} from './dto/space-type.dto';
import { ensurePrimaryAccountOnly } from './spaces.shared';

interface SpaceTypeRecord {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 空间类型列表缓存策略（与空间看板 / 列表同模式）。
 *
 * 空间类型是低频变更的门店运营配置（仅主账号可增改删），命中缓存后
 * GET /space-types 从「鉴权缓存 + 2 次 DB」降为「鉴权缓存 + 0 次 DB」。
 * TTL 只兜底，一致性由写路径 invalidateSpaceTypesCache 主动失效保证。
 */
const SPACE_TYPES_CACHE_TTL_SECONDS = 60;
/** 提前刷新窗口：超过 20s 的命中由后台刷新，避免多端在同一秒集体回源 */
const SPACE_TYPES_CACHE_REFRESH_AFTER_MS = 20_000;

@Injectable()
export class SpaceTypesService {
  private readonly logger = new Logger(SpaceTypesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly redisService: RedisService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async listSpaceTypes(
    user: AuthenticatedUser,
    query: ListSpaceTypesQueryDto,
  ): Promise<SpaceTypeResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间类型',
    );

    if (storeId === null) {
      return [];
    }

    const cacheKey = buildSpaceTypesCacheKey(storeId);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SPACE_TYPES_CACHE_TTL_SECONDS,
      refreshAfterMs: SPACE_TYPES_CACHE_REFRESH_AFTER_MS,
      loadValue: () => this.loadSpaceTypes(storeId),
    });
  }

  private async loadSpaceTypes(
    storeId: number,
  ): Promise<SpaceTypeResponseDto[]> {
    const items = await this.prisma.spaceType.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceTypeResponse(item));
  }

  async createSpaceType(
    user: AuthenticatedUser,
    dto: CreateSpaceTypeDto,
  ): Promise<SpaceTypeResponseDto> {
    // 空间类型配置属于门店运营配置，仅允许主账号操作，子账号均被拒绝。
    ensurePrimaryAccountOnly(user, '空间类型');
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'space:create',
      '无权操作该门店空间类型',
    );
    const name = dto.name.trim();

    const duplicate = await this.prisma.spaceType.findFirst({
      where: { storeId, name },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('空间类型名称已存在');
    }

    let item;
    try {
      item = await this.prisma.spaceType.create({
        data: { storeId, name },
      });
    } catch (err) {
      // BUG-01 fix: 并发创建同名类型触发 @@unique([storeId, name]) 约束，
      // 将 Prisma P2002 归一化为业务友好的 409 ConflictException
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('空间类型名称已存在');
      }
      throw err;
    }

    await this.invalidateSpaceTypesCache(storeId);

    return this.toSpaceTypeResponse(item);
  }

  /**
   * 失效门店空间类型列表缓存。
   *
   * 每个门店的类型列表只有一个确定的 key，直接 DEL 即可，无需全库 SCAN。
   * 写库已经成功，缓存清理失败不能改变接口结果：只记告警并依赖 TTL 兜底，
   * 否则用户会看到「保存失败」但实际上数据已落库。
   */
  private async invalidateSpaceTypesCache(storeId: number): Promise<void> {
    try {
      await this.redisService.del(buildSpaceTypesCacheKey(storeId));
    } catch (err) {
      this.logger.warn(
        `空间类型缓存失效失败（storeId=${storeId}），等待 TTL 兜底：${String(err)}`,
      );
    }
  }

  /**
   * 拦截「被会员卡模板引用」的类型改名 / 删除。
   *
   * 历史卡模板的 usableSpaceTypes 可能存的是类型名称而非 id；改名或删除后
   * 该卡会静默失去开台能力，而已售模板的权益字段禁止常规编辑，用户无法自救。
   *
   * - 改名：只校验旧名引用（id 引用不受改名影响）；
   * - 删除：名称引用和 id 引用都会失效，两者都校验。
   */
  private async assertSpaceTypeNotReferenced(
    storeId: number,
    type: { id: number; name: string },
    scene: 'rename' | 'delete',
  ): Promise<void> {
    const plan = await this.prisma.memberCardPlan.findFirst({
      where: {
        storeId,
        deletedAt: null,
        ...(scene === 'delete'
          ? {
              OR: [
                { usableSpaceTypes: { has: type.name } },
                { usableSpaceTypes: { has: String(type.id) } },
              ],
            }
          : { usableSpaceTypes: { has: type.name } }),
      },
      select: { id: true, name: true },
    });

    if (!plan) {
      return;
    }

    const reference = scene === 'rename' ? '按名称引用' : '引用';
    const suffix =
      scene === 'rename'
        ? '请先调整该会员卡的可用空间类型后再改名'
        : '请先调整该会员卡的可用空间类型后再删除';

    throw new ConflictException(
      `空间类型「${type.name}」已被会员卡「${plan.name}」${reference}，${suffix}`,
    );
  }

  async updateSpaceType(
    user: AuthenticatedUser,
    typeId: number,
    dto: UpdateSpaceTypeDto,
  ): Promise<SpaceTypeResponseDto> {
    // 空间类型配置写操作仅允许主账号，子账号均被拒绝（同 createSpaceType）。
    ensurePrimaryAccountOnly(user, '空间类型');
    const item = await this.prisma.spaceType.findUnique({
      where: { id: typeId },
    });

    if (!item) {
      throw new NotFoundException('空间类型不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:update',
      '无权操作该门店空间类型',
    );

    const name = dto.name.trim();
    if (name !== item.name) {
      const duplicate = await this.prisma.spaceType.findFirst({
        where: {
          storeId: item.storeId,
          name,
          id: { not: item.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException('空间类型名称已存在');
      }

      // 旧名仍被会员卡按名称引用时禁止改名，否则该卡会静默失去开台能力。
      await this.assertSpaceTypeNotReferenced(item.storeId, item, 'rename');
    }

    let updated;
    try {
      updated = await this.prisma.spaceType.update({
        where: { id: item.id },
        data: { name },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // 并发改名到同一名称：预检通过后仍会撞唯一约束，统一归一化为 409。
        if (err.code === 'P2002') {
          throw new ConflictException('空间类型名称已存在');
        }
        // 并发删除：预检与写入之间记录被删掉，按资源不存在返回 404。
        if (err.code === 'P2025') {
          throw new NotFoundException('空间类型不存在');
        }
      }
      throw err;
    }

    await this.invalidateSpaceTypesCache(item.storeId);

    // 空间列表 / 看板缓存内嵌 type.name 快照：只清类型自身缓存不够，
    // 类型改名后必须同步失效空间读缓存，否则看板仍展示旧类型名直到列表 TTL 过期。
    // 写库已成功，缓存清理失败不应让接口报错。
    try {
      await this.cacheInvalidatorService.invalidateSpacesReadCaches(
        item.storeId,
      );
    } catch (err) {
      this.logger.warn(
        `空间读缓存失效失败（storeId=${item.storeId}），等待 TTL 兜底：${String(err)}`,
      );
    }

    return this.toSpaceTypeResponse(updated);
  }

  async resolveSpaceTypeByName(
    storeId: number,
    rawName: string,
  ): Promise<{ id: number; name: string }> {
    const name = rawName.trim();
    const type = await this.prisma.spaceType.findFirst({
      where: { storeId, name },
      select: {
        id: true,
        name: true,
      },
    });

    if (!type) {
      // BUG-06 fix: 引用字段不存在应返回 400（请求体参数无效），而非 404（资源不存在）
      throw new BadRequestException(
        `空间类型「${name}」不存在，请先通过 POST /space-types 创建`,
      );
    }

    return type;
  }

  async removeSpaceType(
    user: AuthenticatedUser,
    typeId: number,
  ): Promise<void> {
    // 空间类型配置写操作仅允许主账号，子账号均被拒绝（同 createSpaceType）。
    ensurePrimaryAccountOnly(user, '空间类型');
    const item = await this.prisma.spaceType.findUnique({
      where: { id: typeId },
      select: {
        id: true,
        name: true,
        storeId: true,
        _count: {
          select: { spaces: { where: { deletedAt: null } } },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('空间类型不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      item.storeId,
      'space:delete',
      '无权删除该门店空间类型',
    );

    if (item._count.spaces > 0) {
      throw new ConflictException('该空间类型已被空间使用，无法删除');
    }

    // 删除同样会让引用该类型的会员卡失效，需前置拦截。
    await this.assertSpaceTypeNotReferenced(item.storeId, item, 'delete');

    try {
      await this.prisma.spaceType.delete({
        where: { id: item.id },
      });
    } catch (err) {
      // B-2 fix: 捕获 FK 约束错误（软删除空间仍持有 typeId 引用时触发）
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        this.logger.warn(
          `空间类型 ${item.id} 删除失败：仍被空间引用（含已删除空间）`,
        );
        throw new ConflictException(
          '该空间类型仍被空间引用（含已删除空间），无法删除',
        );
      }
      throw err;
    }

    await this.invalidateSpaceTypesCache(item.storeId);
  }

  toSpaceTypeResponse(item: SpaceTypeRecord): SpaceTypeResponseDto {
    return {
      id: String(item.id),
      name: item.name,
      createdAt: toTimestampMs(item.createdAt),
      updatedAt: toTimestampMs(item.updatedAt),
    };
  }
}
