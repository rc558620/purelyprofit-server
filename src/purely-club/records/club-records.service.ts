import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubStoresService } from '../stores/club-stores.service';
import type {
  ClubRecordDto,
  ClubRecordFilterValue,
  ClubRecordTypeValue,
  ClubRecordsResponseDto,
  ListClubRecordsQueryDto,
} from './dto/club-record.dto';

interface ClubLedgerCustomerRecord {
  id: number;
  balance: number;
}

interface ClubRechargeLedgerRow {
  id: number;
  amount: number;
  giftAmount: number;
  type: 'recharge' | 'gift' | 'refund';
  note: string | null;
  createdAt: Date;
}

interface ClubConsumptionLedgerRow {
  id: number;
  amount: number;
  balancePaid: number;
  itemsSummary: string | null;
  createdAt: Date;
}

interface ClubLedgerEntry {
  id: string;
  type: ClubRecordTypeValue;
  amountFen: number;
  balanceEffectFen: number;
  description: string;
  createdAt: Date;
}

@Injectable()
export class ClubRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubStoresService: ClubStoresService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListClubRecordsQueryDto,
  ): Promise<ClubRecordsResponseDto> {
    const currentStore = await this.clubStoresService.getCurrent(user);
    const customer = await this.prisma.marketingCustomer.findUnique({
      where: {
        storeId_phone: {
          storeId: currentStore.id,
          phone: user.phone,
        },
      },
      select: {
        id: true,
        balance: true,
      },
    });

    if (!customer) {
      return { items: [] };
    }

    const [recharges, consumptions] = await Promise.all([
      this.prisma.marketingRecharge.findMany({
        where: {
          storeId: currentStore.id,
          customerId: customer.id,
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
      }),
      this.prisma.marketingConsumption.findMany({
        where: {
          storeId: currentStore.id,
          customerId: customer.id,
        },
        select: {
          id: true,
          amount: true,
          balancePaid: true,
          itemsSummary: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const entries = [
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
      });

    const filteredEntries = this.filterEntries(entries, query.type ?? 'all');
    const items = this.buildRecords(
      filteredEntries,
      customer,
      currentStore.name,
    );

    return { items };
  }

  private mapRechargeRow(row: ClubRechargeLedgerRow): ClubLedgerEntry | null {
    switch (row.type) {
      case 'recharge':
        return {
          id: `recharge-${row.id}`,
          type: 'recharge',
          amountFen: row.amount,
          balanceEffectFen: row.amount + row.giftAmount,
          description: this.buildRechargeDescription(row.amount, row.giftAmount),
          createdAt: row.createdAt,
        };
      case 'gift': {
        const bonusAmountFen = row.giftAmount > 0 ? row.giftAmount : row.amount;
        if (bonusAmountFen <= 0) {
          return null;
        }
        return {
          id: `bonus-${row.id}`,
          type: 'bonus',
          amountFen: bonusAmountFen,
          balanceEffectFen: row.amount + row.giftAmount,
          description: row.note?.trim() || `赠送 ¥${this.formatYuan(bonusAmountFen)}`,
          createdAt: row.createdAt,
        };
      }
      case 'refund':
        return {
          id: `refund-${row.id}`,
          type: 'refund',
          amountFen: -row.amount,
          balanceEffectFen: -(row.amount + row.giftAmount),
          description: row.note?.trim() || `退款 ¥${this.formatYuan(row.amount)}`,
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

  private buildRecords(
    entries: ClubLedgerEntry[],
    customer: ClubLedgerCustomerRecord,
    storeName: string,
  ): ClubRecordDto[] {
    let runningBalanceFen = customer.balance;

    return entries.map((entry) => {
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

  private buildRechargeDescription(amountFen: number, giftAmountFen: number): string {
    if (giftAmountFen > 0) {
      return `充值 ¥${this.formatYuan(amountFen)} 赠 ¥${this.formatYuan(giftAmountFen)}`;
    }
    return `充值 ¥${this.formatYuan(amountFen)}`;
  }

  private formatYuan(amountFen: number): string {
    return this.convertFenToYuan(amountFen).toFixed(2).replace(/\.00$/, '');
  }

  private convertFenToYuan(amountFen: number): number {
    return new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();
  }
}
