import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  buildStoreResponseDto,
  normalizeStoreProfileMetadata,
  type StoreProfileMetadata,
  type StoreRecordSnapshot,
  type StoreResponseDto,
} from './dto/store-response.dto';

const STORE_PROFILE_KEY_PREFIX = 'stores:profile:';

/** 门店扩展字段缓存 TTL：7 天，与门店同生命周期量级 */
const STORE_PROFILE_CACHE_TTL_SECONDS = 7 * 24 * 3600;

/**
 * 门店扩展字段读写服务。
 *
 * 持久化事实源为数据库（stores.profile_metadata JSONB），Redis 仅作为读取缓存：
 * - 写入：DB + Redis 双写（DB 失败时记录错误，不阻断主流程；Redis 失败不影响事实源）
 * - 读取：DB 优先；DB 未命中时回退 Redis（兼容历史 Redis 数据并回填 DB）
 * 若 Redis 被清空，扩展字段不会丢失，仍可从数据库恢复。
 */

@Injectable()
export class StoresProfileService {
  private readonly logger = new Logger(StoresProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async mapStoreResponse(
    store: StoreRecordSnapshot,
  ): Promise<StoreResponseDto> {
    const metadata = await this.readStoreProfileMetadata(store.id);
    return buildStoreResponseDto(store, metadata);
  }

  buildStoreResponse(
    store: StoreRecordSnapshot,
    metadata: StoreProfileMetadata,
  ): StoreResponseDto {
    return buildStoreResponseDto(store, metadata);
  }

  async readStoreProfileMetadata(
    storeId: number,
  ): Promise<StoreProfileMetadata> {
    // 1. DB 优先（持久化事实源）
    try {
      const record = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { profileMetadata: true },
      });
      const raw = record?.profileMetadata;
      if (raw !== null && raw !== undefined) {
        const metadata = normalizeStoreProfileMetadata(raw);
        // 异步回填 Redis 缓存（best-effort，不影响读取结果）
        if (Object.keys(metadata).length > 0) {
          this.redisService
            .set(
              this.getStoreProfileKey(storeId),
              JSON.stringify(metadata),
              STORE_PROFILE_CACHE_TTL_SECONDS,
            )
            .catch((error: unknown) => {
              this.logger.warn(
                `回填门店 ${storeId} 扩展字段缓存失败: ${this.getErrorMessage(error)}`,
              );
            });
        }
        return metadata;
      }
    } catch (error) {
      this.logger.warn(
        `读取门店 ${storeId} 扩展字段 DB 失败，回退 Redis：${this.getErrorMessage(error)}`,
      );
    }

    // 2. Redis 兜底（兼容历史 Redis 数据），命中后回填 DB 并回写规范化缓存
    try {
      const raw = await this.redisService.get(this.getStoreProfileKey(storeId));
      if (raw) {
        const metadata = normalizeStoreProfileMetadata(JSON.parse(raw) as unknown);
        if (Object.keys(metadata).length > 0) {
          await this.persistStoreProfileMetadata(storeId, metadata);
        }
        return metadata;
      }
    } catch (error) {
      this.logger.warn(
        `读取门店 ${storeId} 扩展字段 Redis 失败，返回空数据：${this.getErrorMessage(error)}`,
      );
    }

    return normalizeStoreProfileMetadata(null);
  }

  /**
   * 批量读取门店扩展字段，DB 优先，未命中的门店回退 Redis。
   *
   * 返回与 storeIds 入参等长的数组，未命中或解析失败的项返回空 metadata。
   */
  async batchReadStoreProfileMetadata(
    storeIds: number[],
  ): Promise<StoreProfileMetadata[]> {
    if (storeIds.length === 0) {
      return [];
    }

    const result: StoreProfileMetadata[] = storeIds.map(() =>
      normalizeStoreProfileMetadata(null),
    );
    const missingIndexes: number[] = [];

    // 1. DB 批量读取（持久化事实源）
    try {
      const records = await this.prisma.store.findMany({
        where: { id: { in: storeIds } },
        select: { id: true, profileMetadata: true },
      });
      const recordById = new Map(
        records
          .filter((r) => r.profileMetadata !== null && r.profileMetadata !== undefined)
          .map((r) => [r.id, r.profileMetadata as unknown]),
      );
      storeIds.forEach((storeId, index) => {
        const raw = recordById.get(storeId);
        if (raw !== undefined) {
          result[index] = normalizeStoreProfileMetadata(raw);
        } else {
          missingIndexes.push(index);
        }
      });
    } catch (error) {
      this.logger.warn(
        `批量读取门店扩展字段 DB 失败，回退 Redis：${this.getErrorMessage(error)}`,
      );
      storeIds.forEach((_, index) => missingIndexes.push(index));
    }

    // 2. 未命中门店回退 Redis（兼容历史数据）
    if (missingIndexes.length > 0) {
      try {
        const missingStoreIds = missingIndexes.map((i) => storeIds[i]);
        const keys = missingStoreIds.map((id) => this.getStoreProfileKey(id));
        const rawValues = await this.redisService.mgetJson<unknown>(keys);
        missingIndexes.forEach((index, offset) => {
          const raw = rawValues[offset];
          if (raw !== null && raw !== undefined) {
            result[index] = normalizeStoreProfileMetadata(raw);
          }
        });
      } catch (error) {
        this.logger.warn(
          `批量读取门店扩展字段 Redis 失败，将返回空数据：${this.getErrorMessage(error)}`,
        );
      }
    }

    return result;
  }

  async persistStoreProfileMetadata(
    storeId: number,
    metadata: StoreProfileMetadata,
  ): Promise<void> {
    // DB 持久化（事实源）
    await this.persistStoreProfileMetadataToDb(storeId, metadata);
    // Redis 缓存（best-effort）
    try {
      await this.redisService.set(
        this.getStoreProfileKey(storeId),
        JSON.stringify(metadata),
        STORE_PROFILE_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `保存门店 ${storeId} 扩展字段缓存失败，DB 数据不受影响：${this.getErrorMessage(error)}`,
      );
    }
  }

  private async persistStoreProfileMetadataToDb(
    storeId: number,
    metadata: StoreProfileMetadata,
  ): Promise<void> {
    try {
      await this.prisma.store.update({
        where: { id: storeId },
        data: { profileMetadata: metadata as unknown as Prisma.InputJsonValue },
      });
    } catch (error) {
      this.logger.error(
        `保存门店扩展字段到 DB 失败，storeId=${storeId}，门店扩展数据可能丢失：${this.getErrorMessage(error)}`,
      );
      // 不重新抛出：DB 写入失败不应阻断门店创建/更新主流程
    }
  }

  private getStoreProfileKey(storeId: number): string {
    return `${STORE_PROFILE_KEY_PREFIX}${storeId}`;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
