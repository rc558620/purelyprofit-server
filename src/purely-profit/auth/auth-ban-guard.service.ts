import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  buildPulseAdminMemberBanReasonKey,
  buildUserRelatedStoreIdsCacheKey,
} from './auth.utils';
import { AUTH_USER_RELATED_STORE_IDS_CACHE_TTL_SECONDS } from './auth.constants';

@Injectable()
export class AuthBanGuardService {
  private readonly logger = new Logger(AuthBanGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 检查用户是否被全面封禁。
   *
   * 封禁是按门店维度的：只有当用户关联的所有门店都被封禁时，才拒绝登录。
   * 若用户还有至少一个未被封禁的门店，则允许登录。
   */
  async ensureUserNotBanned(userId: number): Promise<void> {
    const relatedStoreIds = await this.findUserRelatedStoreIds(userId);
    if (relatedStoreIds.length === 0) {
      return;
    }

    // 批量 MGET 检查封禁状态，替代逐个 GET
    const banReasonKeys = relatedStoreIds.map((storeId) =>
      buildPulseAdminMemberBanReasonKey(storeId),
    );
    const banReasons = await this.redisService.mgetJson<string | null>(
      banReasonKeys,
    );
    const allStoresBanned = banReasons.every((reason) =>
      Boolean(reason?.trim()),
    );

    if (allStoresBanned) {
      throw new UnauthorizedException('账号已被封禁');
    }
  }

  private async findUserRelatedStoreIds(userId: number): Promise<number[]> {
    const cacheKey = buildUserRelatedStoreIdsCacheKey(userId);

    try {
      const cached = await this.redisService.getJson<number[]>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error: unknown) {
      // 缓存读取失败，回退到数据库查询
      this.logger.warn(
        `读取用户关联门店缓存失败，回退到数据库查询: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const stores = await this.prisma.store.findMany({
      where: {
        deletedAt: null,
        OR: [
          { ownerId: userId },
          {
            staffs: {
              some: {
                userId,
                isActive: true,
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    const storeIds = stores.map((store) => store.id);

    // 异步回填缓存
    this.redisService
      .setJson(
        cacheKey,
        storeIds,
        AUTH_USER_RELATED_STORE_IDS_CACHE_TTL_SECONDS,
      )
      .catch((error: unknown) => {
        // 缓存写入失败不影响鉴权
        this.logger.warn(
          `回填用户关联门店缓存失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    return storeIds;
  }
}
