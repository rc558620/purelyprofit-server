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
  buildSpaceTypesCacheKey,
  buildSpaceTypesPattern,
} from '../../../redis/cache-keys';
import { RedisService } from '../../../redis/redis.service';
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
 * 空间类型列表缓存 TTL（秒）。
 *
 * 空间类型是低频变更的门店运营配置（仅主账号可增改删），命中缓存后
 * GET /space-types 从「6 次 Redis + 2 次 DB」降为「6 次 Redis + 0 次 DB」。
 * TTL 只兜底，一致性由写路径主动失效保证（与空间看板同策略）。
 */
const SPACE_TYPES_CACHE_TTL_SECONDS = 60;

@Injectable()
export class SpaceTypesService {
  private readonly logger = new Logger(SpaceTypesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly redisService: RedisService,
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
    const cached =
      await this.redisService.getJson<SpaceTypeResponseDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const items = await this.prisma.spaceType.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const response = items.map((item) => this.toSpaceTypeResponse(item));

    // 一致性边界：load 与写回之间若发生写请求（写路径提交后按 key 失效），
    // 本次 load 读到的旧值仍会被写回并存活一个 TTL，属于有界陈旧。
    // 空间类型为运营配置、写路径极低频，该窗口可接受。
    await this.redisService.setJson(
      cacheKey,
      response,
      SPACE_TYPES_CACHE_TTL_SECONDS,
    );

    return response;
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
   * 由 create / update / delete 写路径在提交成功后调用，保证列表读旧值不跨写。
   */
  private async invalidateSpaceTypesCache(storeId: number): Promise<void> {
    await this.redisService.delByPattern(buildSpaceTypesPattern(storeId));
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
    }

    const updated = await this.prisma.spaceType.update({
      where: { id: item.id },
      data: { name },
    });

    await this.invalidateSpaceTypesCache(item.storeId);

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
