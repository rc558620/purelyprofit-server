import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisLockService } from '../../redis/redis-lock.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubInviteCodeMapCacheKey } from '../../redis/keys';
import { runClubLockedLoad } from '../shared/club-cache-load-lock.helper';
import {
  clubAccessibleStoreSelect,
  type ClubAccessibleStoreRecord,
} from './club-stores.types';

/** 映射缓存 TTL（秒），1 小时后过期自动刷新 */
const CLUB_INVITE_CODE_MAP_TTL_SECONDS = 3600;

/** 跨 worker 单飞的锁资源（映射表是全局单 key，锁不按门店切分） */
const CLUB_INVITE_CODE_MAP_LOCK_RESOURCE = 'club-invite-code-map:refresh';

/**
 * 抢锁失败方的等待预算：5 × 100ms = 500ms。
 *
 * 回源本身是一次带索引的全表小查询（毫秒级），500ms 足够覆盖正常刷新；
 * 超时即兜底直连，邀请码解析不会因等锁而变慢到影响扫码。
 */
const CLUB_INVITE_CODE_MAP_WAIT_ATTEMPTS = 5;
const CLUB_INVITE_CODE_MAP_WAIT_INTERVAL_MS = 100;

/**
 * 邀请码 → 门店映射服务。
 *
 * 负责 inviteCode 到 storeId 的映射加载与整体缓存：
 * - 优先从 Redis 读取完整映射表，未命中时从 store_invite_codes 表全量构建；
 * - 映射表以整体方式缓存，避免单条缓存碰撞导致的错误固化；
 * - 未命中回源在**跨 worker 单飞**保护下执行：冷启动/过期瞬间只有拿到短租约
 *   的 worker 全表拉取，其余 worker 等待缓存出现后直接复用。任何锁异常都退回
 *   「直接全表拉取」，与改造前行为一致，邀请码解析不会因锁失败而报错。
 */
@Injectable()
export class ClubInviteCodeMapService {
  private readonly logger = new Logger(ClubInviteCodeMapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly redisLockService: RedisLockService,
  ) {}

  /**
   * 根据 inviteCode 查找门店。
   *
   * 先查映射缓存得到 storeId，再按 id 读取门店记录；
   * 映射中不存在该邀请码时返回 null。
   */
  async findStoreByInviteCode(
    inviteCode: string,
  ): Promise<ClubAccessibleStoreRecord | null> {
    const codeMap = await this.loadInviteCodeMap();
    const storeId = codeMap.get(inviteCode) ?? null;
    if (storeId === null) {
      return null;
    }

    return this.prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: clubAccessibleStoreSelect,
    });
  }

  /**
   * 加载 inviteCode→storeId 映射表。
   *
   * 优先从 Redis 读取缓存的整体映射 JSON；
   * 未命中时从数据库的 store_invite_codes 表加载所有活跃邀请码，
   * 构建 inviteCode→storeId 映射后写入缓存。
   */
  async loadInviteCodeMap(): Promise<Map<string, number>> {
    // 1. 尝试从 Redis 读取缓存映射（异常按未命中处理，不阻断扫码）
    const cachedMap = await this.readCachedMap();
    if (cachedMap) {
      return cachedMap;
    }

    // 2. 未命中：集群内单飞，避免冷启动时多 worker 同时全表拉取
    return runClubLockedLoad(
      this.redisLockService,
      {
        lockResource: CLUB_INVITE_CODE_MAP_LOCK_RESOURCE,
        readCached: () => this.readCachedMap(),
        loadAndPublish: () => this.buildAndCacheMap(),
        waitAttempts: CLUB_INVITE_CODE_MAP_WAIT_ATTEMPTS,
        waitIntervalMs: CLUB_INVITE_CODE_MAP_WAIT_INTERVAL_MS,
      },
      this.logger,
    );
  }

  /** 读缓存映射：Redis 读写异常一律降级为「未命中」。 */
  private async readCachedMap(): Promise<Map<string, number> | null> {
    try {
      const cachedMap = await this.redisService.getJson<Record<string, number>>(
        buildClubInviteCodeMapCacheKey(),
      );
      if (!cachedMap || typeof cachedMap !== 'object') {
        return null;
      }
      return new Map(
        Object.entries(cachedMap).map(([code, storeId]) => [code, storeId]),
      );
    } catch (error) {
      this.logger.warn(
        `读取邀请码映射缓存失败，回退数据库: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 全量构建映射并回写缓存（未接入单飞时的原实现）。 */
  private async buildAndCacheMap(): Promise<Map<string, number>> {
    // F9: 过滤掉对应门店已软删（deletedAt != null）的邀请码，避免缓存污染
    const inviteCodes = await this.prisma.storeInviteCode.findMany({
      where: {
        isActive: true,
        store: { deletedAt: null },
      },
      select: { code: true, storeId: true },
      orderBy: { storeId: 'asc' },
    });

    const codeMap = new Map<string, number>();

    for (const record of inviteCodes) {
      if (codeMap.has(record.code)) {
        // 同一门店有多个活跃码时记录警告，保留第一条（storeId 较小的先入）
        this.logger.warn(
          `邀请码映射冲突: code=${record.code} 已映射到门店 ${codeMap.get(record.code)}，跳过门店 ${record.storeId}`,
        );
      } else {
        codeMap.set(record.code, record.storeId);
      }
    }

    await this.writeCachedMap(codeMap);

    return codeMap;
  }

  /** 回写缓存：失败只影响下次是否命中，不改变本次结果。 */
  private async writeCachedMap(codeMap: Map<string, number>): Promise<void> {
    const mapObject: Record<string, number> = {};
    for (const [code, storeId] of codeMap) {
      mapObject[code] = storeId;
    }
    try {
      await this.redisService.setJson(
        buildClubInviteCodeMapCacheKey(),
        mapObject,
        CLUB_INVITE_CODE_MAP_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `写入邀请码映射缓存失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
