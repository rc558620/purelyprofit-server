import { Injectable, NotFoundException } from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import type { ClubMemberHeldLevelValue } from '../dto/club-member-account.dto';

const CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE = '当前门店暂无会员账户信息';

interface ClubMemberAccountRecord {
  id: number;
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

export interface ClubMemberSnapshot {
  memberId: number;
  storeId: number;
  balance: number;
  level: ClubMemberHeldLevelValue;
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
    const snapshot = await this.getSnapshotByStoreAndPhone(
      currentContext.store.id,
      currentContext.user.phone,
    );
    if (!snapshot) {
      throw new NotFoundException(CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE);
    }

    return snapshot;
  }

  async getSnapshotByStoreAndPhone(
    storeId: number,
    phone: string,
  ): Promise<ClubMemberSnapshot | null> {
    const [member, marketingCustomer] = await Promise.all([
      this.findCurrentMember(storeId, phone),
      this.findMarketingCustomer(storeId, phone),
    ]);

    if (!member) {
      return null;
    }

    const joinDate = this.resolveJoinDate(
      member.createdAt,
      marketingCustomer?.createdAt,
    );

    return {
      memberId: member.id,
      storeId,
      balance: this.convertFenToYuan(marketingCustomer?.balance ?? 0),
      level: this.resolveLevel(member.level, marketingCustomer?.tier),
      points: marketingCustomer?.points ?? member.points,
      memberCode: this.buildMemberCode(joinDate, member.id),
      joinDate,
      totalConsume: this.resolveTotalConsume(
        member.totalConsumeAmount,
        marketingCustomer?.totalSpent ?? null,
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
    memberLevel: string,
    marketingTier: string | undefined,
  ): ClubMemberHeldLevelValue {
    // 优先以 member.level 为准，该字段语义和 club 等级体系完全对齐
    switch (memberLevel) {
      case 'diamond':
        return 'diamond';
      case 'platinum':
        return 'platinum';
      case 'gold':
        return 'gold';
      case 'silver':
        return 'silver';
      default:
        break;
    }

    // member.level 无有效等级（free / bronze / regular 等历史值）时，
    // 用 marketingTier 补充白银/钻石历史持有信息。
    // 注意：营销 tier 'gold' 不做映射——其门槛（¥2000）远低于 club 铂金门槛（¥5000），
    // 若直接映射会导致充值达到铂金门槛后 heldLevel 仍停留在 'gold'，
    // 与 currentLevel（由 totalConsume vs spendThreshold 计算得出的铂金）不一致。
    switch (marketingTier) {
      case 'diamond':
        return 'diamond';
      case 'silver':
        return 'silver';
      default:
        break;
    }

    // 最终回落到普通会员（无等级折扣）
    return 'regular';
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

  /**
   * 解析累计消费金额。
   *
   * 优先使用 marketingCustomer.totalSpent（消费侧实时累计，包含服务购买+充值），
   * 这才是真正的"累计消费"语义；
   * 若无营销顾客档案则回落到 member.totalConsumeAmount（旧字段，可能不准）。
   */
  private resolveTotalConsume(
    memberTotalConsumeAmount: Decimal,
    marketingTotalSpentFen: number | null,
  ): number {
    if (typeof marketingTotalSpentFen === 'number') {
      return this.convertFenToYuan(marketingTotalSpentFen);
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
