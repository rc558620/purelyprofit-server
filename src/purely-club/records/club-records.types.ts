import type { ClubRecordTypeValue } from './dto/club-record.dto';

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
