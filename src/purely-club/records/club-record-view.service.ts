import { Injectable } from '@nestjs/common';
import { Money } from '../../shared/money.utils';
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
  /**
   * 余额快照基准：不受 filterType 影响的全量储值账户流水（通常由查询层提供）。
   * 缺省时回退为 entries（兼容旧调用）。
   */
  balanceEntries?: ClubLedgerEntry[];
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
   * 1. 对流水按时间正序排列（从最旧到最新）
   * 2. 起始余额 = customer.balance（当前余额） - 所有已加载流水的 balanceEffectFen 之和
   *    这样即使只加载了部分流水，同一批次内的余额快照也是连贯的
   * 3. 从最旧的流水开始，逐条加上 balanceEffectFen，得到每笔流水后的余额
   * 4. 最终输出仍按时间倒序（最新在前）
   *
   * 注意：余额快照必须基于**全量储值账户流水**（balanceEntries）。
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

    // 余额快照基准优先取全量流水；缺省（旧调用）回退为过滤结果
    const balanceEntries = params.balanceEntries?.length
      ? params.balanceEntries
      : filteredEntries;

    // 按时间正序排列（从最旧到最新）用于计算余额快照
    const ascending = [...balanceEntries].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    // 计算所有已加载流水的余额变动总和
    const totalEffectFen = ascending.reduce(
      (sum, entry) => sum + entry.balanceEffectFen,
      0,
    );

    // 起始余额 = 当前余额 - 总变动 = 最旧一条流水发生前的余额
    let runningBalanceFen = customer.balance - totalEffectFen;

    // 正推计算每笔流水后的余额快照
    const snapshotMap = new Map<string, number>();
    for (const entry of ascending) {
      runningBalanceFen += entry.balanceEffectFen;
      snapshotMap.set(entry.id, runningBalanceFen);
    }

    // 按原始倒序输出（filteredEntries 保持原传入的倒序）
    return filteredEntries.map((entry) => {
      const balanceSnapshotFen = snapshotMap.get(entry.id) ?? 0;
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
