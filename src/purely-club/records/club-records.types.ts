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

/** 流水列表查询结果：展示用分页条目 + 余额快照基准条目 */
export interface ListLedgerEntriesResult {
  /** 当前页展示条目（已按 filterType 过滤并按时间倒序） */
  items: ClubLedgerEntry[];
  /** 符合筛选条件的流水总条数 */
  total: number;
  /**
   * 余额快照基准条目：**不受 filterType 影响**的全量储值账户流水（时间升序）。
   *
   * 为什么需要单独返回：余额快照由「当前余额 − 本批流水余额变动之和」反推，
   * 若只拿展示用的过滤结果，充值与赠送会被排除，反推起点被抬高，
   * 展示出的「余额」将严重偏离真实储值余额。
   */
  balanceEntries: ClubLedgerEntry[];
}
