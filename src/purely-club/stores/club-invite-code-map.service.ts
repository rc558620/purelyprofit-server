import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubInviteCodeMapCacheKey } from '../../redis/keys';
import {
  clubAccessibleStoreSelect,
  type ClubAccessibleStoreRecord,
} from './club-stores.types';

/** 映射缓存 TTL（秒），1 小时后过期自动刷新 */
const CLUB_INVITE_CODE_MAP_TTL_SECONDS = 3600;

/**
 * 邀请码 → 门店映射服务。
 *
 * 负责 inviteCode 到 storeId 的映射加载与整体缓存：
 * - 优先从 Redis 读取完整映射表，未命中时从 store_invite_codes 表全量构建；
 * - 映射表以整体方式缓存，避免单条缓存碰撞导致的错误固化。
 */
@Injectable()
export class ClubInviteCodeMapService {
  private readonly logger = new Logger(ClubInviteCodeMapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
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
    // 1. 尝试从 Redis 读取缓存映射
    const cachedMap = await this.redisService.getJson<Record<string, number>>(
      buildClubInviteCodeMapCacheKey(),
    );
    if (cachedMap && typeof cachedMap === 'object') {
      return new Map(
        Object.entries(cachedMap).map(([k, v]) => [k, v as number]),
      );
    }

    // 2. 缓存未命中，从 store_invite_codes 表加载所有活跃邀请码
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

    // 3. 写入缓存供后续请求使用
    const mapObject: Record<string, number> = {};
    for (const [code, id] of codeMap) {
      mapObject[code] = id;
    }
    await this.redisService.setJson(
      buildClubInviteCodeMapCacheKey(),
      mapObject,
      CLUB_INVITE_CODE_MAP_TTL_SECONDS,
    );

    return codeMap;
  }
}
