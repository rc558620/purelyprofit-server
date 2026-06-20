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

    // 充值累计：通过 marketingRecharge 聚合计算该顾客在该门店的累计充值金额（分）
    const totalRechargeFen =
      await this.aggregateTotalRechargeAmount(marketingCustomer?.id ?? null);

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
      totalConsume: this.resolveTotalRecharge(
        member.totalConsumeAmount,
        totalRechargeFen,
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
        createdAt: true,
      },
    });
  }

  /**
   * 聚合计算指定营销顾客的累计充值金额（分）。
   * 仅统计 type='recharge' 的记录，即用户实际充值的本金部分。
   */
  private async aggregateTotalRechargeAmount(
    customerId: number | null,
  ): Promise<number | null> {
    if (customerId === null) {
      return null;
    }

    const result = await this.prisma.marketingRecharge.aggregate({
      where: { customerId, type: 'recharge' },
      _sum: { amount: true },
    });

    return result._sum.amount ?? 0;
  }

  private resolveLevel(
    memberLevel: string,
    marketingTier: string | undefined,
  ): ClubMemberHeldLevelValue {
    // 优先以 member.level 为准，该字段语义和 club 等级体系完全对齐
    // silver 等级已废弃，member.level 为 silver 时回落到 regular
    switch (memberLevel) {
      case 'diamond':
        return 'diamond';
      case 'platinum':
        return 'platinum';
      case 'gold':
        return 'gold';
      default:
        break;
    }

    // member.level 无有效等级（free / bronze / regular 等历史值）时，
    // 用 marketingTier 补充钻石历史持有信息。
    // 注意：营销 tier 'gold' 不做映射——其门槛（¥2000）远低于 club 铂金门槛（¥5000），
    // 若直接映射会导致充值达到铂金门槛后 heldLevel 仍停留在 'gold'，
    // 与 currentLevel（由 totalConsume vs spendThreshold 计算得出的铂金）不一致。
    // silver 等级已废弃，marketingTier 为 silver 时回落到 regular。
    switch (marketingTier) {
      case 'diamond':
        return 'diamond';
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
   * 解析累计充值金额。
   *
   * 优先使用 marketingRecharge 聚合的充值累计（仅 type='recharge' 记录），
   * 这才是真正的"累计充值"语义——会员等级仅通过充值升级；
   * 若无营销顾客档案则回落到 member.totalConsumeAmount（旧字段，可能不准）。
   */
  private resolveTotalRecharge(
    memberTotalConsumeAmount: Decimal,
    totalRechargeFen: number | null,
  ): number {
    if (typeof totalRechargeFen === 'number') {
      return this.convertFenToYuan(totalRechargeFen);
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

  /**
   * 将 Date 格式化为 YYYY-MM-DD 字符串，固定使用 UTC+8（北京时间）。
   * 避免服务器部署在 UTC 时区时导致入会日期偏移一天。
   */
  private formatDateOnly(date: Date): string {
    // UTC+8 偏移量 8 小时 = 8 * 60 * 60 * 1000 = 28800000 毫秒
    const utc8Ms = date.getTime() + 8 * 60 * 60 * 1000;
    const utc8Date = new Date(utc8Ms);
    const year = utc8Date.getUTCFullYear();
    const month = String(utc8Date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utc8Date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
