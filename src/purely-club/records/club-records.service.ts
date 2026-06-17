import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubRecordsResponseDto,
  ListClubRecordsQueryDto,
} from './dto/club-record.dto';
import { ClubRecordQueryService } from './club-record-query.service';
import { ClubRecordViewService } from './club-record-view.service';

@Injectable()
export class ClubRecordsService {
  constructor(
    private readonly clubRecordQueryService: ClubRecordQueryService,
    private readonly clubRecordViewService: ClubRecordViewService,
  ) {}

  async list(
    currentContext: ClubCurrentContext,
    query: ListClubRecordsQueryDto,
  ): Promise<ClubRecordsResponseDto> {
    const customer =
      await this.clubRecordQueryService.findCustomerByStoreAndPhone(
        currentContext.store.id,
        currentContext.user.phone,
      );

    if (!customer) {
      return { items: [] };
    }

    const entries = await this.clubRecordQueryService.listLedgerEntries(
      currentContext.store.id,
      customer.id,
      query.limit,
    );

    return {
      items: this.clubRecordViewService.buildRecordItems({
        entries,
        filterType: query.type ?? 'all',
        customer,
        storeName: currentContext.store.name,
      }),
    };
  }
}
