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
   * 封禁是按门店维度的：只有当用户关联的所有门店都被封禁时，才拒绝访问。
   * 若用户还有至少一个未被封禁的门店，则放行。
   */
  async ensureUserNotBanned(userId: number): Promise<void> {
    const relatedStoreIds = await this.findUserRelatedStoreIds(userId);
    await this.assertNotAllStoresBanned(relatedStoreIds);
  }

  /**
   * 关联门店 ID 已由调用方批量取回时复用同一封禁判定（JWT 鉴权链路使用）。
   *
   * 第 1 次 Redis 往返已经把 `related_store_ids` 原始值一并取回，这里不再单独读一次缓存，
   * 只保留依赖它的第二跳（各门店封禁原因 MGET）。
   *
   * `rawRelatedStoreIds` 为 null 表示批量读取未命中，回源数据库并回填——
   * 与 `ensureUserNotBanned` 走完全相同的路径，判定条件与异常文案没有任何差异。
   */
  async ensureUserNotBannedWithRelatedStoreIdsCache(
    userId: number,
    rawRelatedStoreIds: string | null,
  ): Promise<void> {
    const cached = this.parseRelatedStoreIds(rawRelatedStoreIds);
    const relatedStoreIds =
      cached !== null ? cached : await this.loadRelatedStoreIdsFromDb(userId);
    await this.assertNotAllStoresBanned(relatedStoreIds);
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

  /**
   * 全部关联门店都被封禁时抛错。判定条件与原实现一致：
   * 每个门店的封禁原因都非空才算「全封」。
   */
  private async assertNotAllStoresBanned(
    relatedStoreIds: number[],
  ): Promise<void> {
    if (relatedStoreIds.length === 0) {
      return;
    }

    const banReasons = await this.readBanReasons(relatedStoreIds);
    const allStoresBanned = banReasons.every((reason) =>
      Boolean(reason?.trim()),
    );

    if (allStoresBanned) {
      throw new UnauthorizedException('账号已被封禁');
    }
  }

  /**
   * 批量读取各门店封禁原因（封禁检查的第二跳）。
   *
   * MGET 整体失败时**降级为逐条读取**：读取的 key 集合与判定条件完全一致，
   * 只是把一次往返拆成 N 次；逐条读取仍然失败则照原逻辑抛错。
   * 选择降级而不是直接抛错的原因：MGET 失败可能只是批量命令层面的问题
   * （超时、pipeline 中断），此时把「整站登录全部失败」降级成「多花几次往返」
   * 更符合可用性要求；而无论哪条路径，都不会把「读不到」当成「未封禁」。
   */
  private async readBanReasons(
    relatedStoreIds: number[],
  ): Promise<(string | null)[]> {
    const banReasonKeys = relatedStoreIds.map((storeId) =>
      buildPulseAdminMemberBanReasonKey(storeId),
    );

    try {
      return await this.redisService.mgetJson<string | null>(banReasonKeys);
    } catch (error: unknown) {
      this.logger.warn(
        `批量读取门店封禁状态失败，降级为逐条读取: ${this.describeError(error)}`,
      );
      return Promise.all(
        banReasonKeys.map((key) =>
          this.redisService.getJson<string | null>(key),
        ),
      );
    }
  }

  private async findUserRelatedStoreIds(userId: number): Promise<number[]> {
    const cached = await this.readCachedRelatedStoreIds(
      buildUserRelatedStoreIdsCacheKey(userId),
    );
    const relatedStoreIds =
      cached !== null ? cached : await this.loadRelatedStoreIdsFromDb(userId);
    return relatedStoreIds;
  }

  /**
   * 读取关联门店缓存；读取失败按「未命中」处理并告警。
   *
   * 这里不能抛错：缓存只是加速层，回源数据库仍能得到权威结论；
   * 但也不能把失败当成「没有任何关联门店」——那会让封禁检查直接跳过。
   */
  private async readCachedRelatedStoreIds(
    cacheKey: string,
  ): Promise<number[] | null> {
    try {
      return await this.redisService.getJson<number[]>(cacheKey);
    } catch (error: unknown) {
      this.logger.warn(
        `读取用户关联门店缓存失败，回退到数据库查询: ${this.describeError(error)}`,
      );
      return null;
    }
  }

  /**
   * 解析批量读取到的 `related_store_ids` 原始 JSON。
   *
   * null 表示未命中；解析失败或类型不符也按未命中处理（宁可多查一次库，
   * 也不能拿一份结构异常的数据去推断封禁结论）。
   */
  private parseRelatedStoreIds(raw: string | null): number[] | null {
    if (raw === null) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch (error: unknown) {
      this.logger.warn(
        `解析用户关联门店缓存失败，回退到数据库查询: ${this.describeError(error)}`,
      );
      return null;
    }
  }

  private async loadRelatedStoreIdsFromDb(userId: number): Promise<number[]> {
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
    this.backfillRelatedStoreIds(
      buildUserRelatedStoreIdsCacheKey(userId),
      storeIds,
    );

    return storeIds;
  }

  /**
   * fire-and-forget 回填关联门店缓存，写失败只告警、不影响鉴权。
   * 采用 void + try/catch 的显式写法（规范禁止 Promise 链式 catch）。
   */
  private backfillRelatedStoreIds(cacheKey: string, storeIds: number[]): void {
    void (async () => {
      try {
        await this.redisService.setJson(
          cacheKey,
          storeIds,
          AUTH_USER_RELATED_STORE_IDS_CACHE_TTL_SECONDS,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `回填用户关联门店缓存失败: ${this.describeError(error)}`,
        );
      }
    })();
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
