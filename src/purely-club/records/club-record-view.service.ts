import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type {
  ClubRecordDto,
  ClubRecordFilterValue,
} from './dto/club-record.dto';
import type {
  ClubLedgerCustomerRecord,
  ClubLedgerEntry,
} from './club-records.types';

interface BuildRecordItemsParams {
  entries: ClubLedgerEntry[];
  filterType: ClubRecordFilterValue;
  customer: ClubLedgerCustomerRecord;
  storeName: string;
}

@Injectable()
export class ClubRecordViewService {
  buildRecordItems(params: BuildRecordItemsParams): ClubRecordDto[] {
    const { entries, filterType, customer, storeName } = params;
    const filteredEntries = this.filterEntries(entries, filterType);
    let runningBalanceFen = customer.balance;

    return filteredEntries.map((entry) => {
      const record: ClubRecordDto = {
        id: entry.id,
        type: entry.type,
        amount: this.convertFenToYuan(entry.amountFen),
        description: entry.description,
        createdAt: entry.createdAt.toISOString(),
        balanceSnapshot: this.convertFenToYuan(runningBalanceFen),
        storeName,
      };

      runningBalanceFen -= entry.balanceEffectFen;
      return record;
    });
  }

  private filterEntries(
    entries: ClubLedgerEntry[],
    filterType: ClubRecordFilterValue,
  ): ClubLedgerEntry[] {
    switch (filterType) {
      case 'recharge':
        return entries.filter(
          (entry) => entry.type === 'recharge' || entry.type === 'bonus',
        );
      case 'consume':
        return entries.filter(
          (entry) => entry.type === 'consume' || entry.type === 'refund',
        );
      case 'all':
      default:
        return entries;
    }
  }

  private convertFenToYuan(amountFen: number): number {
    return new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();
  }
}
