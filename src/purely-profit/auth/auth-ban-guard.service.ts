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

  /**
   * 检查用户是否已被注销（pulse 管理端注销门店 → store 软删除）。
   *
   * 仅当用户是某门店 owner 且其名下所有门店均已注销、
   * 同时在其他门店也没有任何在职员工身份时，才拒绝登录。
   * 纯新用户（从未开店）不受影响，可正常登录注册流程。
   */
  async ensureUserNotCancelled(userId: number): Promise<void> {
    const [ownedStores, activeStaffCount] = await Promise.all([
      this.prisma.store.findMany({
        where: { ownerId: userId },
        select: { deletedAt: true },
      }),
      this.prisma.staff.count({
        where: {
          userId,
          isActive: true,
          status: 'active',
          store: { deletedAt: null },
        },
      }),
    ]);

    if (ownedStores.length === 0 || activeStaffCount > 0) {
      return;
    }

    const allOwnedStoresCancelled = ownedStores.every(
      (store) => store.deletedAt !== null,
    );
    if (allOwnedStoresCancelled) {
      throw new UnauthorizedException('账号已注销，该手机号可重新注册使用');
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
