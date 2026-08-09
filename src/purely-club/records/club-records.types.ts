import type {
  ClubRecordFilterValue,
  ClubRecordTypeValue,
} from './dto/club-record.dto';

export interface ClubLedgerCustomerRecord {
  id: number;
  balance: number;
}

export interface ClubRechargeLedgerRow {
  id: number;
  amount: number;
  giftAmount: number;
  totalAmount: number;
  type: 'recharge' | 'gift' | 'refund';
  note: string | null;
  createdAt: Date;
}

export interface ClubConsumptionLedgerRow {
  id: number;
  amount: number;
  balancePaid: number;
  itemsSummary: string | null;
  createdAt: Date;
}

export interface ClubLedgerEntry {
  id: string;
  type: ClubRecordTypeValue;
  amountFen: number;
  balanceEffectFen: number;
  description: string;
  createdAt: Date;
}

/** 流水列表查询参数：每页条数、复合游标与类型筛选 */
export interface ListLedgerEntriesOptions {
  /** 每页条数，默认 50 */
  limit?: number;
  /** 分页游标（上一页最后一条的 createdAt + id） */
  cursor?: { createdAt: Date; id: string };
  /** 类型筛选：all=全部 recharge=充值与赠送 consume=消费与退款 */
  filterType?: ClubRecordFilterValue;
}
