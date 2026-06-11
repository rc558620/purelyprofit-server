import { Injectable, NotFoundException } from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import type { ClubMemberLevelValue } from '../dto/club-member-account.dto';

const CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE = '当前门店暂无会员账户信息';

interface ClubMemberAccountRecord {
  id: number;
  level: string;
  points: number;
  totalConsumeAmount: Decimal;
  createdAt: Date;
}

interface ClubMarketingCustomerRecord {
  balance: number;
  points: number;
  tier: string;
  totalSpent: number;
  createdAt: Date;
}

export interface ClubMemberSnapshot {
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
export class ClubMemberProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentSnapshot(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberSnapshot> {
    const member = await this.findCurrentMember(
      currentContext.store.id,
      currentContext.user.phone,
    );
    if (!member) {
      throw new NotFoundException(CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE);
    }

    const marketingCustomer = await this.findMarketingCustomer(
      currentContext.store.id,
      currentContext.user.phone,
    );
    const joinDate = this.resolveJoinDate(
      member.createdAt,
      marketingCustomer?.createdAt,
    );

    return {
      memberId: member.id,
      storeId: currentContext.store.id,
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
