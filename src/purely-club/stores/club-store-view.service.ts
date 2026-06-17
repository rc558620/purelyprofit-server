import { Injectable } from '@nestjs/common';
import { StoresProfileService } from '../../purely-profit/stores/stores-profile.service';
import type { ClubStoreSummaryDto } from './dto/club-store.dto';
import type { ClubAccessibleStoreRecord } from './club-stores.types';

@Injectable()
export class ClubStoreViewService {
  constructor(private readonly storesProfileService: StoresProfileService) {}

  async toSummaries(
    stores: ClubAccessibleStoreRecord[],
  ): Promise<ClubStoreSummaryDto[]> {
    return Promise.all(stores.map((store) => this.toSummary(store)));
  }

  async toSummary(
    store: ClubAccessibleStoreRecord,
  ): Promise<ClubStoreSummaryDto> {
    const metadata = await this.storesProfileService.readStoreProfileMetadata(
      store.id,
    );

    return {
      id: store.id,
      name: store.name,
      address: store.address ?? '',
      // TODO: 等门店数据模型增加 businessHours 字段后，基于当前时间与营业时段动态计算
      isOpen: true,
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
