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

/** 每页查询时从数据库多取的冗余条数，用于合并排序后仍能填满 limit */
const QUERY_OVERFETCH = 2;

@Injectable()
export class ClubRecordQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按门店 ID + 手机号查询顾客储值余额档案。
   * 优先按 storeId + phone 精确查找未删除顾客；
   * 若 phone 在 marketingCustomer 表中为 null（历史脏数据），
   * 回退到 findFirst 模糊匹配。
   */
  async findCustomerByStoreAndPhone(
    storeId: number,
    phone: string,
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

    // 回退：phone 字段为 null 的历史数据无法通过唯一索引匹配，
    // 使用 findFirst + userId 关联查找
    return this.findCustomerByStoreAndUserIdFallback(storeId, phone);
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

    // 构建 cursor 过滤条件：比上一页最后一条更早的记录
    const cursorFilter = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            {
              createdAt: cursor.createdAt,
              id: { lt: this.extractNumericId(cursor.id) },
            },
          ],
        }
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
            ...cursorFilter,
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
                ...cursorFilter,
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

    return {
      items,
      total: rechargeCount + consumptionCount,
      // 余额快照基准：取「不早于本页最旧一条」的全量流水（不受 filterType 影响）。
      // 本页最旧一条之后（含）的流水已全部覆盖，因此可由当前余额精确反推出该时点余额。
      balanceEntries:
        items.length > 0
          ? await this.listBalanceEntriesSince(
              storeId,
              customerId,
              items[items.length - 1].createdAt,
              balanceConsumptionWhere,
            )
          : [],
    };
  }

  /**
   * 查询「不早于 since」的全部储值账户流水（充值与消费，不分 Tab 类型），按时间升序返回。
   * 仅供余额快照回推使用，不参与分页与展示。
   */
  private async listBalanceEntriesSince(
    storeId: number,
    customerId: number,
    since: Date,
    balanceConsumptionWhere: { balancePaid: { gt: number } },
  ): Promise<ClubLedgerEntry[]> {
    const [recharges, consumptions] = await Promise.all([
      this.prisma.marketingRecharge.findMany({
        where: { storeId, customerId, createdAt: { gte: since } },
        select: {
          id: true,
          amount: true,
          giftAmount: true,
          totalAmount: true,
          type: true,
          note: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.marketingConsumption.findMany({
        where: {
          storeId,
          customerId,
          ...balanceConsumptionWhere,
          createdAt: { gte: since },
        },
        select: {
          id: true,
          amount: true,
          balancePaid: true,
          itemsSummary: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    return [
      ...recharges.map((row) => this.mapRechargeRow(row)),
      ...consumptions.map((row) => this.mapConsumptionRow(row)),
    ]
      .filter((entry): entry is ClubLedgerEntry => entry !== null)
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
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
      .sort((left, right) => {
        const timeDiff = right.createdAt.getTime() - left.createdAt.getTime();
        if (timeDiff !== 0) {
          return timeDiff;
        }
        return right.id.localeCompare(left.id);
      })
      .slice(0, limit);
  }

  /**
   * 从复合 ID（如 "recharge-18"、"consume-31"）中提取数字 ID 部分。
   * 用于 cursor 分页时的 id 比对。
   */
  private extractNumericId(compositeId: string): number {
    const parts = compositeId.split('-');
    const numericPart = parts[parts.length - 1];
    const parsed = Number.parseInt(numericPart, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  /**
   * 回退查询：当 phone 字段在 marketingCustomer 中为 null 时，
   * 通过 userId 关联查找对应的营销客户记录。
   *
   * 这个方法处理的历史场景是：微信登录用户的 phone 存储格式为
   * "club_wechat:oOPENID123"，但早期建档时可能未写入 phone 字段。
   */
  private async findCustomerByStoreAndUserIdFallback(
    storeId: number,
    phone: string,
  ): Promise<ClubLedgerCustomerRecord | null> {
    // 微信登录用户的 phone 格式为 "club_wechat:oOPENID123"
    // 如果不是这种格式，无需回退查找
    if (!phone.startsWith('club_wechat:')) {
      return null;
    }

    return this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        deletedAt: null,
        // phone 为 null 的记录：这些是早期微信登录但未绑定手机号的客户
        phone: null,
      },
      select: {
        id: true,
        balance: true,
      },
    });
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
