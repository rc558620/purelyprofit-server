import { Injectable } from '@nestjs/common';
import { Money } from '../../shared/money.utils';
import type {
  ClubRecordDto,
  ClubRecordFilterValue,
} from './dto/club-record.dto';
import type {
  ClubLedgerBalanceWindow,
  ClubLedgerCustomerRecord,
  ClubLedgerEntry,
} from './club-records.types';
import {
  buildLedgerBalanceSnapshotsFromEntries,
  buildLedgerBalanceSnapshotsFromWindow,
} from './club-record-ledger-order.util';

interface BuildRecordItemsParams {
  entries: ClubLedgerEntry[];
  /**
   * 余额快照基准：不受 filterType 影响的**全量储值账户流水**聚合值，
   * 由查询层在 DB 侧用窗口函数算出（只回传标量）。
   * 缺省时降级为「按本页 filteredEntries 全量反推」，保持旧调用行为不变。
   */
  balanceWindow?: ClubLedgerBalanceWindow | null;
  filterType: ClubRecordFilterValue;
  customer: ClubLedgerCustomerRecord;
  storeName: string;
}

@Injectable()
export class ClubRecordViewService {
  /**
   * 将流水条目转换为前端展示结构，并计算每笔流水后的余额快照。
   *
   * 余额快照算法（正推法）：
   * 1. 起始余额 = customer.balance（当前余额） − 窗口内全部流水的影响合计
   * 2. 每条快照 = 起始余额 + 该条在窗口内的累计影响（含自身）
   * 3. 输出仍按时间倒序（最新在前）
   *
   * 注意：快照基准必须基于**全量储值账户流水**（balanceWindow）。
   * 若误用按 Tab 过滤后的 entries，充值与赠送会被排除，反推起点被抬高，
   * 展示出的「余额」将严重偏离真实储值余额。
   * 当只加载了部分流水（分页场景）时，最旧几条的余额快照可能与真实历史余额有偏差
   * （因为更早的流水未加载），但同一页内的快照是连贯且相对正确的。
   */
  buildRecordItems(params: BuildRecordItemsParams): ClubRecordDto[] {
    const { entries, filterType, customer, storeName } = params;
    const filteredEntries = this.filterEntries(entries, filterType);

    if (filteredEntries.length === 0) {
      return [];
    }

    const snapshots = params.balanceWindow
      ? buildLedgerBalanceSnapshotsFromWindow(
          params.balanceWindow,
          customer.balance,
        )
      : buildLedgerBalanceSnapshotsFromEntries({
          entries: filteredEntries,
          currentBalanceFen: customer.balance,
        });

    // 按原始倒序输出（filteredEntries 保持原传入的倒序）
    return filteredEntries.map((entry) => {
      const balanceSnapshotFen = snapshots[entry.id] ?? 0;
      const record: ClubRecordDto = {
        id: entry.id,
        type: entry.type,
        amount: Money.fromDbCents(entry.amountFen).toOutputYuan(),
        description: entry.description,
        createdAt: entry.createdAt.toISOString(),
        balanceSnapshot: Money.fromDbCents(balanceSnapshotFen).toOutputYuan(),
        storeName,
      };

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
}
