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
  /**
   * 是否统计总条数，默认 true。
   *
   * 游标翻页时调用方可以传 false：两张表各少一次 count，
   * 而「是否还有下一页」由 overfetch 结果直接得出，不依赖 count。
   */
  withTotal?: boolean;
}

/**
 * 余额快照窗口：本页最旧一条（含）之后**全量**储值账户流水在数据库侧的聚合结果。
 *
 * 只回传标量，不把流水行拉回 Node：窗口随会员历史流水增长而无上界，
 * 逐行求和必须下推到 DB（`SUM(...) OVER (ORDER BY ... ROWS UNBOUNDED PRECEDING)`）。
 */
export interface ClubLedgerBalanceWindow {
  /** 窗口内全部流水的余额影响合计（分） */
  totalEffectFen: number;
  /** 窗口内每条流水（含自身）的余额影响累计（分），键为复合流水 ID */
  cumulativeEffectFenById: Record<string, number>;
}

/** 流水列表查询结果：展示用分页条目 + 余额快照窗口 */
export interface ListLedgerEntriesResult {
  /** 当前页展示条目（已按 filterType 过滤并按时间倒序） */
  items: ClubLedgerEntry[];
  /** 符合筛选条件的流水总条数；withTotal=false 时为 null（本次未统计） */
  total: number | null;
  /**
   * 是否还有下一页。
   *
   * 由「两张表各多取 limit*2 条、合并后是否超过 limit」直接得出，
   * 因此与 total 是否统计完全解耦，不会因为跳过 count 而失真。
   */
  hasMore: boolean;
  /**
   * 余额快照基准：**不受 filterType 影响**的全量储值账户流水聚合值。
   *
   * 为什么需要单独算：余额快照由「当前余额 − 窗口合计 + 本条的窗口内累计」得出，
   * 若只拿展示用的过滤结果，充值与赠送会被排除，反推起点被抬高，
   * 展示出的「余额」将严重偏离真实储值余额。
   */
  balanceWindow: ClubLedgerBalanceWindow | null;
}
