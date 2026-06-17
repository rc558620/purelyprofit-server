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

      // Compare stringified result with raw to detect normalization changes
      // Use a stable stringify to avoid key-order discrepancies
      const normalizedRaw = JSON.stringify(metadata);
      if (normalizedRaw !== raw) {
        await this.persistStoreProfileMetadata(storeId, metadata);
      }

      return metadata;
    } catch (error) {
      this.logger.warn(
        `读取门店扩展字段失败，storeId=${storeId}: ${this.getErrorMessage(error)}`,
      );
      return normalizeStoreProfileMetadata(null);
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
      );
    } catch (error) {
      this.logger.warn(
        `保存门店扩展字段失败，storeId=${storeId}: ${this.getErrorMessage(error)}`,
      );
    }
  }

  private getStoreProfileKey(storeId: number): string {
    return `${STORE_PROFILE_KEY_PREFIX}${storeId}`;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
