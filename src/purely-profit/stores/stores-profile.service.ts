import { Injectable, Logger } from '@nestjs/common';
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
 * 门店扩展字段不设 TTL——storeType / region / storeLogo / 经纬度是门店核心属性，
 * 需要与门店同生命周期存续；数据源为 Redis 而非数据库，属于当前架构的已知约束。
 * 若 Redis 被清空，门店扩展字段将丢失，需通过门店编辑接口重新写入。
 */

@Injectable()
export class StoresProfileService {
  private readonly logger = new Logger(StoresProfileService.name);

  constructor(private readonly redisService: RedisService) {}

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
    try {
      const raw = await this.redisService.get(this.getStoreProfileKey(storeId));
      if (!raw) {
        return normalizeStoreProfileMetadata(null);
      }

      const metadata = normalizeStoreProfileMetadata(
        JSON.parse(raw) as unknown,
      );

      // 使用 key 排序后的序列化结果与 raw 比较，避免 key 顺序差异导致无意义的回写
      const normalizedRaw = this.stableStringify(metadata);
      const sortedRaw = this.stableStringify(JSON.parse(raw));
      if (normalizedRaw !== sortedRaw) {
        await this.persistStoreProfileMetadata(storeId, metadata);
      }

      return metadata;
    } catch (error) {
      this.logger.error(
        `读取门店扩展字段失败，storeId=${storeId}，将返回空数据：${this.getErrorMessage(error)}`,
      );
      return normalizeStoreProfileMetadata(null);
    }
  }

  /**
   * 批量读取门店扩展字段，使用 mget 减少 Redis 往返次数（N+1 → 1）。
   *
   * 返回与 storeIds 入参等长的数组，未命中或解析失败的项返回空 metadata。
   */
  async batchReadStoreProfileMetadata(
    storeIds: number[],
  ): Promise<StoreProfileMetadata[]> {
    if (storeIds.length === 0) {
      return [];
    }

    try {
      const keys = storeIds.map((id) => this.getStoreProfileKey(id));
      const rawValues = await this.redisService.mgetJson<unknown>(keys);

      return rawValues.map((raw) => {
        if (raw === null) {
          return normalizeStoreProfileMetadata(null);
        }
        return normalizeStoreProfileMetadata(raw);
      });
    } catch (error) {
      this.logger.error(
        `批量读取门店扩展字段失败，将返回空数据：${this.getErrorMessage(error)}`,
      );
      return storeIds.map(() => normalizeStoreProfileMetadata(null));
    }
  }

  async persistStoreProfileMetadata(
    storeId: number,
    metadata: StoreProfileMetadata,
  ): Promise<void> {
    try {
      await this.redisService.set(
        this.getStoreProfileKey(storeId),
        JSON.stringify(metadata),
        STORE_PROFILE_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.error(
        `保存门店扩展字段失败，storeId=${storeId}，门店扩展数据可能丢失：${this.getErrorMessage(error)}`,
      );
    }
  }

  private getStoreProfileKey(storeId: number): string {
    return `${STORE_PROFILE_KEY_PREFIX}${storeId}`;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * 对 JSON 对象按 key 字母序排序后序列化，确保相同数据结构总是产生相同字符串，
   * 避免 JSON.stringify 因 key 插入顺序不同而产生差异。
   */
  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((key) => {
      const val = obj[key];
      // 跳过 undefined 值（与 JSON.stringify 行为一致）
      if (val === undefined) {
        return null;
      }
      return `${JSON.stringify(key)}:${this.stableStringify(val)}`;
    });
    return `{${pairs.filter((p) => p !== null).join(',')}}`;
  }
}
