import { Injectable } from '@nestjs/common';
import { Money } from '../../shared/money.utils';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClubConsumptionLedgerRow,
  ClubLedgerCustomerRecord,
  ClubLedgerEntry,
  ClubRechargeLedgerRow,
  ListLedgerEntriesOptions,
  ListLedgerEntriesResult,
} from './club-records.types';
import type { ClubRecordSummaryDto } from './dto/club-record.dto';
import {
  LEDGER_KIND_RANK,
  RECHARGE_TYPE_KIND_RANK,
  compareLedgerEntriesDesc,
  parseCompositeId,
} from './club-record-ledger-order.util';
import { queryLedgerBalanceWindow } from './club-record-balance-window.query';

/** 每页查询时从数据库多取的冗余条数，用于合并排序后仍能填满 limit */
const QUERY_OVERFETCH = 2;

@Injectable()
export class ClubRecordQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按门店 ID + 手机号查询顾客储值余额档案。
   *
   * 优先级：storeId + phone 精确匹配 → `clubUserId` 精确定位。
   * 两步都落空就返回 null（展示空列表），**不再**模糊兜底。
   *
   * @param clubUserId 当前用户的 ID。必填：未绑手机号用户的顾客档案 phone 可能为 null，
   *   此时 clubUserId 是唯一可靠的认人依据；缺失它只能退化成「门店 + phone IS NULL」
   *   的模糊匹配，会把同店其他无手机号顾客的余额当成自己的。
   */
  async findCustomerByStoreAndPhone(
    storeId: number,
    phone: string,
    clubUserId: number,
  ): Promise<ClubLedgerCustomerRecord | null> {
    const exact = await this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        phone,
        deletedAt: null,
      },
      select: {
        id: true,
        balance: true,
      },
    });

    if (exact) {
      return exact;
    }

    // 按 clubUserId 精确定位（稳定键，不依赖 phone 处于真实号 / club_wechat 占位值 / null 哪种形态）
    return this.prisma.marketingCustomer.findFirst({
      where: { storeId, clubUserId, deletedAt: null },
      select: { id: true, balance: true },
    });
  }

  /**
   * 计算指定客户在指定门店的流水汇总：充值总额（含赠送）、储值消费总额。
   *
   * 消费口径与列表严格一致：只统计真正扣减储值余额的部分（balancePaid），
   * 现金/微信/空间结算等未动用储值余额的消费不计入累计消费。
   * 使用数据库 SUM 聚合，保证精度且不需要前端遍历。
   */
  async calculateSummary(
    storeId: number,
    customerId: number,
  ): Promise<ClubRecordSummaryDto> {
    const [rechargeSum, consumptionSum] = await Promise.all([
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          customerId,
          type: { in: ['recharge', 'gift'] },
        },
        _sum: {
          totalAmount: true,
        },
      }),
      this.prisma.marketingConsumption.aggregate({
        where: {
          storeId,
          customerId,
          balancePaid: { gt: 0 },
        },
        _sum: {
          balancePaid: true,
        },
      }),
    ]);

    return {
      totalRechargeAmount: Money.fromDbCents(
        rechargeSum._sum.totalAmount ?? 0,
      ).toOutputYuan(),
      totalConsumeAmount: Money.fromDbCents(
        consumptionSum._sum.balancePaid ?? 0,
      ).toOutputYuan(),
    };
  }

  /**
   * 列出指定客户在指定门店的统一流水条目（按时间倒序）。
   *
   * 类型筛选在数据库查询层完成（recharge=充值与赠送，consume=消费与退款），
   * 确保每页稳定返回 limit 条且游标基于筛选后数据。
   *
   * 储值账户流水口径：消费条目只保留 `balancePaid > 0`（真正扣减储值余额）的行；
   * 现金/微信支付的空间结算等消费不改变余额，不属于本页流水。
   *
   * @param storeId    门店 ID
   * @param customerId 营销客户 ID
   * @param options    分页与筛选参数
   */
  async listLedgerEntries(
    storeId: number,
    customerId: number,
    options: ListLedgerEntriesOptions = {},
  ): Promise<ListLedgerEntriesResult> {
    const { limit = 50, cursor, filterType = 'all' } = options;
    const overfetchLimit = limit * QUERY_OVERFETCH;
    // 储值账户流水口径：只有余额支付部分才影响储值余额
    const balanceConsumptionWhere = { balancePaid: { gt: 0 } };

    // 构建 cursor 过滤条件：比上一页最后一条更早的记录。
    // 充值表与消费表的 kind 构成不同，必须分别构造，否则跨表共用同一数字阈值会漏数据。
    const rechargeCursorWhere = cursor
      ? this.buildRechargeCursorWhere(cursor)
      : {};
    const consumptionCursorWhere = cursor
      ? this.buildConsumptionCursorWhere(cursor)
      : {};

    // 充值表类型过滤：all/recharge 排除退款，consume 仅退款；消费表在 recharge 筛选下无需查询
    const rechargeTypeFilter =
      filterType === 'consume'
        ? { type: 'refund' as const }
        : { type: { not: 'refund' as const } };
    const needConsumptionTable = filterType !== 'recharge';

    const [recharges, consumptions, rechargeCount, consumptionCount] =
      await Promise.all([
        this.prisma.marketingRecharge.findMany({
          where: {
            storeId,
            customerId,
            ...rechargeTypeFilter,
            ...rechargeCursorWhere,
          },
          select: {
            id: true,
            amount: true,
            giftAmount: true,
            totalAmount: true,
            type: true,
            note: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: overfetchLimit,
        }),
        needConsumptionTable
          ? this.prisma.marketingConsumption.findMany({
              where: {
                storeId,
                customerId,
                ...balanceConsumptionWhere,
                ...consumptionCursorWhere,
              },
              select: {
                id: true,
                amount: true,
                balancePaid: true,
                itemsSummary: true,
                createdAt: true,
              },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: overfetchLimit,
            })
          : Promise.resolve<ClubConsumptionLedgerRow[]>([]),
        this.prisma.marketingRecharge.count({
          where: { storeId, customerId, ...rechargeTypeFilter },
        }),
        needConsumptionTable
          ? this.prisma.marketingConsumption.count({
              where: { storeId, customerId, ...balanceConsumptionWhere },
            })
          : Promise.resolve(0),
      ]);

    const items = this.mergeAndSliceEntries(recharges, consumptions, limit);

    const oldestItem = items.length > 0 ? items[items.length - 1] : null;
    // 余额快照基准：取「不早于本页最旧一条」的全量流水（不受 filterType 影响），
    // 在 DB 侧用窗口函数求合计与逐条累计，只回传本页 ≤limit 条标量。
    // 本页最旧一条之后（含）的流水已全部覆盖，因此可由当前余额精确反推出该时点余额。
    const balanceWindow = oldestItem
      ? await queryLedgerBalanceWindow(this.prisma, {
          storeId,
          customerId,
          since: oldestItem.createdAt,
          entryIds: items.map((item) => item.id),
        })
      : null;

    return {
      items,
      total: rechargeCount + consumptionCount,
      balanceWindow,
    };
  }

  /**
   * 合并充值与消费条目：过滤无效行后按时间倒序（同刻按 id 倒序）裁剪到 limit。
   */
  private mergeAndSliceEntries(
    rechargeRows: ClubRechargeLedgerRow[],
    consumptionRows: ClubConsumptionLedgerRow[],
    limit: number,
  ): ClubLedgerEntry[] {
    return [
      ...rechargeRows.map((row) => this.mapRechargeRow(row)),
      ...consumptionRows.map((row) => this.mapConsumptionRow(row)),
    ]
      .filter((entry): entry is ClubLedgerEntry => entry !== null)
      .sort(compareLedgerEntriesDesc)
      .slice(0, limit);
  }

  /**
   * 构建充值表的游标过滤条件。
   *
   * 充值表一个表对应多种 kind（refund / recharge / gift→bonus），
   * 需按 type 分别判定它们在全序 (createdAt, kindRank, numericId) 中的位置：
   * - kind 权重小于游标：该 kind 整体排在游标之后（更旧）→ 同刻记录全取
   * - kind 权重等于游标：与本页最后一条同 kind → 取数字主键更小者
   * - kind 权重大于游标：该 kind 整体排在游标之前（更新）→ 已展示过，排除
   */
  private buildRechargeCursorWhere(
    cursor: NonNullable<ListLedgerEntriesOptions['cursor']>,
  ) {
    const { kindRank: cursorRank, numericId: cursorNumericId } =
      parseCompositeId(cursor.id);

    const sameMoment: Array<{
      createdAt: Date;
      type: 'recharge' | 'gift' | 'refund';
      id?: { lt: number };
    }> = [];

    for (const [type, rank] of RECHARGE_TYPE_KIND_RANK) {
      // 排在游标之前（更新）的同刻记录已展示过
      if (rank > cursorRank) {
        continue;
      }

      const condition: {
        createdAt: Date;
        type: 'recharge' | 'gift' | 'refund';
        id?: { lt: number };
      } = { createdAt: cursor.createdAt, type };

      if (rank === cursorRank) {
        condition.id = { lt: cursorNumericId };
      }

      sameMoment.push(condition);
    }

    return { OR: [{ createdAt: { lt: cursor.createdAt } }, ...sameMoment] };
  }

  /**
   * 构建消费表的游标过滤条件（该表只对应 consume 一种 kind，权重固定）。
   */
  private buildConsumptionCursorWhere(
    cursor: NonNullable<ListLedgerEntriesOptions['cursor']>,
  ) {
    const { kindRank: cursorRank, numericId: cursorNumericId } =
      parseCompositeId(cursor.id);
    const consumeRank = LEDGER_KIND_RANK.consume;

    // 消费 kind 整体排在游标之前（更新）→ 同刻记录已展示过，全部排除
    if (consumeRank > cursorRank) {
      return { OR: [{ createdAt: { lt: cursor.createdAt } }] };
    }

    const condition: { createdAt: Date; id?: { lt: number } } = {
      createdAt: cursor.createdAt,
    };
    if (consumeRank === cursorRank) {
      condition.id = { lt: cursorNumericId };
    }

    return { OR: [{ createdAt: { lt: cursor.createdAt } }, condition] };
  }

  private mapRechargeRow(row: ClubRechargeLedgerRow): ClubLedgerEntry | null {
    switch (row.type) {
      case 'recharge':
        return {
          id: `recharge-${row.id}`,
          type: 'recharge',
          amountFen: row.amount,
          balanceEffectFen: row.totalAmount,
          description: this.buildRechargeDescription(
            row.amount,
            row.giftAmount,
          ),
          createdAt: row.createdAt,
        };
      case 'gift': {
        // 赠送类型：bonusAmountFen 为实际入账金额
        // giftAmount > 0 时取 giftAmount，否则取 amount（历史脏数据兼容）
        const bonusAmountFen = row.giftAmount > 0 ? row.giftAmount : row.amount;
        if (bonusAmountFen <= 0) {
          return null;
        }

        // gift 类型的余额变动仅计入实际入账的赠送金额，
        // 不重复计入 amount（本金部分已在对应 recharge 记录中计入）
        const balanceEffectFen =
          row.giftAmount > 0 ? row.giftAmount : row.amount;

        return {
          id: `bonus-${row.id}`,
          type: 'bonus',
          amountFen: bonusAmountFen,
          balanceEffectFen,
          description:
            row.note?.trim() || `赠送 ¥${this.formatYuan(bonusAmountFen)}`,
          createdAt: row.createdAt,
        };
      }
      case 'refund':
        return {
          id: `refund-${row.id}`,
          type: 'refund',
          amountFen: -row.amount,
          // 退款时扣减的余额 = 本金 + 赠送部分（若退款时赠送金额也被收回）
          balanceEffectFen: -row.totalAmount,
          description:
            row.note?.trim() || `退款 ¥${this.formatYuan(row.amount)}`,
          createdAt: row.createdAt,
        };
      default:
        return null;
    }
  }

  private mapConsumptionRow(
    row: ClubConsumptionLedgerRow,
  ): ClubLedgerEntry | null {
    // 储值账户流水：余额变动只由「余额支付部分」产生，
    // 现金/微信/空间结算消费（balancePaid = 0）既不展示也不参与余额快照。
    const deductionFen = row.balancePaid;
    if (deductionFen <= 0) {
      return null;
    }

    return {
      id: `consume-${row.id}`,
      type: 'consume',
      amountFen: -deductionFen,
      balanceEffectFen: -deductionFen,
      description: row.itemsSummary?.trim() || '余额消费',
      createdAt: row.createdAt,
    };
  }

  private buildRechargeDescription(
    amountFen: number,
    giftAmountFen: number,
  ): string {
    if (giftAmountFen > 0) {
      return `充值 ¥${this.formatYuan(amountFen)} 赠 ¥${this.formatYuan(giftAmountFen)}`;
    }

    return `充值 ¥${this.formatYuan(amountFen)}`;
  }

  /** 金额转元文本：统一保留 2 位小数，与列表 amount / balanceSnapshot 口径一致 */
  private formatYuan(amountFen: number): string {
    return Money.fromDbCents(amountFen).toFixedOutputYuan();
  }
}
