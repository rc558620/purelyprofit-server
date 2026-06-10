import type { ClubRechargePackageDto } from './dto/club-recharge.dto';

export interface ClubRechargePromotionRecord {
  id: number;
  name: string;
  description: string;
  params: unknown;
  createdAt: Date;
}

export interface ClubRechargePromotionParams {
  rechargeAmountFen: number;
  giftAmountFen: number;
}

export interface ResolvedRechargeOrderSelection {
  packageId: string | null;
  promotionId: number | null;
  rechargeAmountFen: number;
  bonusAmountFen: number;
  customAmountFen: number | null;
}

export const DEFAULT_CLUB_RECHARGE_PACKAGES: ClubRechargePackageDto[] = [
  {
    id: 'default-100',
    amount: 100,
    bonusAmount: 0,
    recommended: false,
  },
  {
    id: 'default-200',
    amount: 200,
    bonusAmount: 20,
    tag: '送 ¥20',
    recommended: false,
  },
  {
    id: 'default-500',
    amount: 500,
    bonusAmount: 80,
    tag: '最受欢迎',
    recommended: true,
  },
  {
    id: 'default-1000',
    amount: 1000,
    bonusAmount: 200,
    tag: '超值',
    recommended: false,
  },
  {
    id: 'default-2000',
    amount: 2000,
    bonusAmount: 500,
    tag: '送 ¥500',
    recommended: false,
  },
  {
    id: 'default-5000',
    amount: 5000,
    bonusAmount: 1500,
    tag: '钻石首选',
    recommended: false,
  },
];
