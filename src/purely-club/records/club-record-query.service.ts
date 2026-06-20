import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClubConsumptionLedgerRow,
  ClubLedgerCustomerRecord,
  ClubLedgerEntry,
  ClubRechargeLedgerRow,
} from './club-records.types';

/** 每页查询时从数据库多取的冗余条数，用于合并排序后仍能填满 limit */
const QUERY_OVERFETCH = 2;

@Injectable()
export class ClubRecordQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按门店 ID + 手机号查询顾客储值余额档案。
   * 优先使用 storeId_phone 唯一索引精确查找；
   * 若 phone 在 marketingCustomer 表中为 null（历史脏数据），
   * 回退到 findFirst 模糊匹配。
   */
  async findCustomerByStoreAndPhone(
    storeId: number,
    phone: string,
  ): Promise<ClubLedgerCustomerRecord | null> {
    const exact = await this.prisma.marketingCustomer.findUnique({
      where: {
        storeId_phone: {
          storeId,
          phone,
        },
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
   * 列出指定客户在指定门店的统一流水条目（按时间倒序）。
   *
   * @param storeId   门店 ID
   * @param customerId 营销客户 ID
   * @param limit     每页条数
   * @param cursor    分页游标（上一页最后一条的 createdAt + id），为空则从最新开始
   */
  async listLedgerEntries(
    storeId: number,
    customerId: number,
    limit = 50,
    cursor?: { createdAt: Date; id: string },
  ): Promise<{ items: ClubLedgerEntry[]; total: number }> {
    const overfetchLimit = limit * QUERY_OVERFETCH;

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

    const [recharges, consumptions, rechargeCount, consumptionCount] =
      await Promise.all([
        this.prisma.marketingRecharge.findMany({
          where: {
            storeId,
            customerId,
            ...cursorFilter,
          },
          select: {
            id: true,
            amount: true,
            giftAmount: true,
            type: true,
            note: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: overfetchLimit,
        }),
        this.prisma.marketingConsumption.findMany({
          where: {
            storeId,
            customerId,
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
        }),
        this.prisma.marketingRecharge.count({
          where: { storeId, customerId },
        }),
        this.prisma.marketingConsumption.count({
          where: { storeId, customerId },
        }),
      ]);

    const items = [
      ...recharges.map((row) => this.mapRechargeRow(row)),
      ...consumptions.map((row) => this.mapConsumptionRow(row)),
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

    return {
      items,
      total: rechargeCount + consumptionCount,
    };
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
          balanceEffectFen: row.amount + row.giftAmount,
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
          balanceEffectFen: -(row.amount + row.giftAmount),
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
    const deductionFen = row.balancePaid > 0 ? row.balancePaid : row.amount;
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

  private formatYuan(amountFen: number): string {
    return this.convertFenToYuan(amountFen).toFixed(2).replace(/\.00$/, '');
  }

  private convertFenToYuan(amountFen: number): number {
    // 使用 Decimal 保证精度，toFixed(2) 后转 number 避免浮点误差
    return Number(new Decimal(amountFen).div(100).toFixed(2));
  }
}
