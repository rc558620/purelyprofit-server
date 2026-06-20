import { Injectable } from '@nestjs/common';
import type { StoreProfileMetadata } from '../../purely-profit/stores/dto/store-response.dto';
import { StoresProfileService } from '../../purely-profit/stores/stores-profile.service';
import type { ClubStoreSummaryDto } from './dto/club-store.dto';
import type { ClubAccessibleStoreRecord } from './club-stores.types';

@Injectable()
export class ClubStoreViewService {
  constructor(private readonly storesProfileService: StoresProfileService) {}

  async toSummaries(
    stores: ClubAccessibleStoreRecord[],
  ): Promise<ClubStoreSummaryDto[]> {
    if (stores.length === 0) {
      return [];
    }

    // 批量读取所有门店 metadata，将 N+1 Redis 查询降为 1 次 mget
    const storeIds = stores.map((store) => store.id);
    const metadataList =
      await this.storesProfileService.batchReadStoreProfileMetadata(storeIds);

    return stores.map((store, index) =>
      this.toSummaryFromMetadata(store, metadataList[index]),
    );
  }

  async toSummary(
    store: ClubAccessibleStoreRecord,
  ): Promise<ClubStoreSummaryDto> {
    const metadata = await this.storesProfileService.readStoreProfileMetadata(
      store.id,
    );

    return this.toSummaryFromMetadata(store, metadata);
  }

  private toSummaryFromMetadata(
    store: ClubAccessibleStoreRecord,
    metadata: StoreProfileMetadata,
  ): ClubStoreSummaryDto {
    return {
      id: store.id,
      name: store.name,
      address: store.address ?? '',
      // TODO: 等门店数据模型增加 businessHours 字段后，基于当前时间与营业时段动态计算 isOpen
      // 当前阶段未配置营业时间，不返回 isOpen 和 businessHours 字段，前端按默认营业中处理
      ...(metadata.storeLogo ? { coverImage: metadata.storeLogo } : {}),
      ...(metadata.latitude !== undefined
        ? { latitude: metadata.latitude }
        : {}),
      ...(metadata.longitude !== undefined
        ? { longitude: metadata.longitude }
        : {}),
    };
  }
}
