import { Injectable, NotFoundException } from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubStoresService } from '../stores/club-stores.service';
import {
  type ClubMemberAccountDto,
  type ClubMemberLevelConfigDto,
  type ClubMemberLevelStatusDto,
  type ClubMemberLevelValue,
} from './dto/club-member-account.dto';

const CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE = '当前门店暂无会员账户信息';

const CLUB_MEMBER_LEVEL_CONFIGS: ClubMemberLevelConfigDto[] = [
  {
    level: 'bronze',
    label: '普通会员',
    color: '#8c613c',
    bgColor: '#f7ede4',
    requiredConsume: 0,
    discountRate: 0.95,
    benefits: ['9.5 折会员专属价', '基础预约通道', '生日问候礼包'],
  },
  {
    level: 'silver',
    label: '白银会员',
    color: '#7b8794',
    bgColor: '#eef2f6',
    requiredConsume: 1000,
    discountRate: 0.92,
    benefits: ['9.2 折会员专属价', '每月护理券 1 张', '节日专属礼遇'],
  },
  {
    level: 'gold',
    label: '黄金会员',
    color: '#b7862f',
    bgColor: '#fbf3df',
    requiredConsume: 3000,
    discountRate: 0.9,
    benefits: ['9 折会员专属价', '每月免费项目 2 次', '专属客服顾问', '生日礼品券 ¥100', '优先预约通道', '节日专属礼包'],
  },
  {
    level: 'platinum',
    label: '铂金会员',
    color: '#5b6fa8',
    bgColor: '#eef2ff',
    requiredConsume: 5000,
    discountRate: 0.85,
    benefits: ['8.5 折会员专属价', '无限次免费项目', '一对一专属顾问', '生日礼品券 ¥200', 'VIP 专属包厢', '节日专属礼包', '年度护理方案定制'],
  },
  {
    level: 'diamond',
    label: '钻石会员',
    color: '#9f67d4',
    bgColor: '#f5f0ff',
    requiredConsume: 10000,
    discountRate: 0.8,
    benefits: ['8 折会员专属价', '全项目无限次免费', '私人顾问 24h 服务', '生日礼品券 ¥500', 'VIP 专属套间', '年度护理方案定制', '专属限定福利礼盒', '节假日优先预约保障'],
  },
];

interface ClubMemberAccountRecord {
  id: number;
  storeId: number;
  level: string;
  points: number;
  totalConsumeAmount: Decimal;
  createdAt: Date;
}

interface ClubMarketingCustomerRecord {
  id: number;
  balance: number;
  points: number;
  tier: string;
  totalSpent: number;
  createdAt: Date;
}

interface ClubMemberSnapshot {
  memberId: number;
  storeId: number;
  balance: number;
  level: ClubMemberLevelValue;
  points: number;
  memberCode: string;
  joinDate: string;
  totalConsume: number;
}

@Injectable()
export class ClubMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubStoresService: ClubStoresService,
  ) {}

  async getAccount(user: AuthenticatedUser): Promise<ClubMemberAccountDto> {
    const snapshot = await this.getMemberSnapshot(user);
    return {
      id: String(snapshot.memberId),
      storeId: String(snapshot.storeId),
      balance: snapshot.balance,
      level: snapshot.level,
      points: snapshot.points,
      memberCode: snapshot.memberCode,
      joinDate: snapshot.joinDate,
      totalConsume: snapshot.totalConsume,
    };
  }

  async getLevels(): Promise<ClubMemberLevelConfigDto[]> {
    return CLUB_MEMBER_LEVEL_CONFIGS.map((config) => ({
      ...config,
      benefits: [...config.benefits],
    }));
  }

  async getLevelStatus(
    user: AuthenticatedUser,
  ): Promise<ClubMemberLevelStatusDto> {
    const snapshot = await this.getMemberSnapshot(user);
    const currentLevelConfig = this.findLevelConfig(snapshot.level);
    const nextLevelConfig = CLUB_MEMBER_LEVEL_CONFIGS.find(
      (config) => config.requiredConsume > snapshot.totalConsume,
    );

    if (!nextLevelConfig) {
      return {
        currentLevel: snapshot.level,
        currentLevelLabel: currentLevelConfig.label,
        currentRequiredConsume: currentLevelConfig.requiredConsume,
        totalConsume: snapshot.totalConsume,
        nextLevel: null,
        nextLevelLabel: null,
        nextRequiredConsume: null,
        amountToNextLevel: 0,
        progressPct: 100,
        isTopLevel: true,
      };
    }

    return {
      currentLevel: snapshot.level,
      currentLevelLabel: currentLevelConfig.label,
      currentRequiredConsume: currentLevelConfig.requiredConsume,
      totalConsume: snapshot.totalConsume,
      nextLevel: nextLevelConfig.level,
      nextLevelLabel: nextLevelConfig.label,
      nextRequiredConsume: nextLevelConfig.requiredConsume,
      amountToNextLevel: this.calculateAmountToNextLevel(
        snapshot.totalConsume,
        nextLevelConfig.requiredConsume,
      ),
      progressPct: this.calculateProgressPct(
        snapshot.totalConsume,
        nextLevelConfig.requiredConsume,
      ),
      isTopLevel: false,
    };
  }

  private async getMemberSnapshot(
    user: AuthenticatedUser,
  ): Promise<ClubMemberSnapshot> {
    const currentStore = await this.clubStoresService.getCurrent(user);
    const member = await this.findCurrentMember(currentStore.id, user.phone);
    if (!member) {
      throw new NotFoundException(CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE);
    }

    const marketingCustomer = await this.findMarketingCustomer(
      currentStore.id,
      user.phone,
    );
    const joinDate = this.resolveJoinDate(
      member.createdAt,
      marketingCustomer?.createdAt,
    );

    return {
      memberId: member.id,
      storeId: currentStore.id,
      balance: this.convertFenToYuan(marketingCustomer?.balance ?? 0),
      level: this.resolveLevel(marketingCustomer?.tier, member.level),
      points: marketingCustomer?.points ?? member.points,
      memberCode: this.buildMemberCode(joinDate, member.id),
      joinDate,
      totalConsume: this.resolveTotalConsume(
        member.totalConsumeAmount,
        marketingCustomer?.totalSpent,
      ),
    };
  }

  private async findCurrentMember(
    storeId: number,
    phone: string,
  ): Promise<ClubMemberAccountRecord | null> {
    return this.prisma.member.findFirst({
      where: {
        storeId,
        phone,
        status: { not: MemberStatus.BANNED },
      },
      select: {
        id: true,
        storeId: true,
        level: true,
        points: true,
        totalConsumeAmount: true,
        createdAt: true,
      },
    });
  }

  private async findMarketingCustomer(
    storeId: number,
    phone: string,
  ): Promise<ClubMarketingCustomerRecord | null> {
    return this.prisma.marketingCustomer.findUnique({
      where: {
        storeId_phone: {
          storeId,
          phone,
        },
      },
      select: {
        id: true,
        balance: true,
        points: true,
        tier: true,
        totalSpent: true,
        createdAt: true,
      },
    });
  }

  private resolveLevel(
    marketingTier: string | undefined,
    memberLevel: string,
  ): ClubMemberLevelValue {
    switch (marketingTier) {
      case 'silver':
        return 'silver';
      case 'gold':
        return 'gold';
      case 'diamond':
        return 'diamond';
      case 'regular':
        return 'bronze';
      default:
        break;
    }

    switch (memberLevel) {
      case 'silver':
        return 'silver';
      case 'gold':
        return 'gold';
      case 'platinum':
        return 'platinum';
      case 'diamond':
        return 'diamond';
      case 'bronze':
      case 'regular':
      case 'free':
      default:
        return 'bronze';
    }
  }

  private findLevelConfig(
    level: ClubMemberLevelValue,
  ): ClubMemberLevelConfigDto {
    return (
      CLUB_MEMBER_LEVEL_CONFIGS.find((config) => config.level === level) ??
      CLUB_MEMBER_LEVEL_CONFIGS[0]
    );
  }

  private resolveJoinDate(
    memberCreatedAt: Date,
    marketingCreatedAt: Date | undefined,
  ): string {
    const joinedAt =
      marketingCreatedAt &&
      marketingCreatedAt.getTime() < memberCreatedAt.getTime()
        ? marketingCreatedAt
        : memberCreatedAt;
    return this.formatDateOnly(joinedAt);
  }

  private resolveTotalConsume(
    memberTotalConsumeAmount: Decimal,
    marketingTotalSpent: number | undefined,
  ): number {
    if (typeof marketingTotalSpent === 'number') {
      return this.convertFenToYuan(marketingTotalSpent);
    }

    return new Decimal(memberTotalConsumeAmount.toString())
      .toDecimalPlaces(2)
      .toNumber();
  }

  private calculateAmountToNextLevel(
    totalConsume: number,
    nextRequiredConsume: number,
  ): number {
    return Decimal.max(
      0,
      new Decimal(nextRequiredConsume).minus(totalConsume),
    )
      .toDecimalPlaces(2)
      .toNumber();
  }

  private calculateProgressPct(
    totalConsume: number,
    nextRequiredConsume: number,
  ): number {
    if (nextRequiredConsume <= 0) {
      return 100;
    }

    return Decimal.min(
      100,
      new Decimal(totalConsume)
        .div(nextRequiredConsume)
        .mul(100)
        .toDecimalPlaces(2),
    ).toNumber();
  }

  private convertFenToYuan(amountFen: number): number {
    return new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();
  }

  private buildMemberCode(joinDate: string, memberId: number): string {
    const compactDate = joinDate.replace(/-/g, '');
    return `PC${compactDate}${String(memberId).padStart(3, '0')}`;
  }

  private formatDateOnly(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
