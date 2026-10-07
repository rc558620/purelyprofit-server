import { Injectable, NotFoundException } from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { buildClubMemberSnapshotCacheKey } from '../../../redis/keys/club-cache-keys';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import type { ClubMemberHeldLevelValue } from '../dto/club-member-account.dto';

const CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE = '当前门店暂无会员账户信息';

/** 会员快照缓存 TTL（秒） */
const CLUB_MEMBER_SNAPSHOT_CACHE_TTL_SECONDS = 15;
/** null 快照缓存 TTL（秒）：防穿透，比正常 TTL 更短 */
const CLUB_MEMBER_SNAPSHOT_NULL_CACHE_TTL_SECONDS = 5;

/** 缓存 null 哨兵：JSON.stringify(null) === 'null'，getJson 会解析回 null */
const NULL_SENTINEL = null;

interface ClubMemberAccountRecord {
  id: number;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async getCurrentSnapshot(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberSnapshot> {
    const snapshot = await this.getSnapshotByStoreIdentity(
      currentContext.store.id,
      currentContext.user.id,
      currentContext.user.phone,
    );
    if (!snapshot) {
      throw new NotFoundException(CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE);
    }

    return snapshot;
  }

  /**
   * 定位**当前登录者本人**在本店的会员与顾客档案快照。
   *
   * 查询语义与 ClubStoreAccessService.buildMemberIdentityWhere 一致（两层）：
   * 1. `(storeId, clubUserId)` 权威锚点；
   * 2. 锚点落空才按手机号认领**无主**（clubUserId 为 null）档案。
   *
   * 缺第 2 层限定的话，同门店两条同号档案时 findFirst 命中谁并不确定，
   * 会把别人的余额/积分当成自己的。
   */
  async getSnapshotByStoreIdentity(
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<ClubMemberSnapshot | null> {
    // 读缓存：门店+用户粒度，TTL 15s
    const cacheKey = buildClubMemberSnapshotCacheKey(storeId, clubUserId);
    const cached = await this.redisService.getJson<ClubMemberSnapshot | null>(
      cacheKey,
    );
    if (cached !== null) {
      return cached;
    }
    // 区分「缓存了 null 哨兵」与「未命中」：getJson 返回 null 有两种含义
    // —— 已缓存 null（哨兵）或 key 不存在。用 exists 做二次确认。
    const hasNullSentinel = await this.redisService.exists(cacheKey);
    if (hasNullSentinel) {
      return NULL_SENTINEL;
    }

    const [member, marketingCustomer] = await Promise.all([
      this.findCurrentMember(storeId, clubUserId, phone),
      this.findMarketingCustomer(storeId, clubUserId, phone),
    ]);
    const snapshot = await this.buildSnapshot(
      storeId,
      member,
      marketingCustomer,
    );

    // 写缓存：非 null 写 15s，null 写 5s 防穿透
    const ttl =
      snapshot !== null
        ? CLUB_MEMBER_SNAPSHOT_CACHE_TTL_SECONDS
        : CLUB_MEMBER_SNAPSHOT_NULL_CACHE_TTL_SECONDS;
    await this.redisService.setJson(cacheKey, snapshot, ttl);

    return snapshot;
  }

  /**
   * 商家侧（purelyProfit 营销场景）按顾客手机号查询快照。
   *
   * 与 getSnapshotByStoreIdentity 的区别：这里的 phone 是**查询输入**而非
   * 登录者身份凭据——商家本就可见全部顾客，不存在越权问题，因此不做两层锚定。
   * 顾客本人的接口一律走 getSnapshotByStoreIdentity。
   */
  async getSnapshotByStoreAndPhone(
    storeId: number,
    phone: string,
  ): Promise<ClubMemberSnapshot | null> {
    const [member, marketingCustomer] = await Promise.all([
      this.prisma.member.findFirst({
        where: {
          storeId,
          phone,
          status: { not: MemberStatus.banned },
          deletedAt: null,
        },
        select: {
          id: true,
          createdAt: true,
        },
      }),
      this.prisma.marketingCustomer.findFirst({
        where: {
          storeId,
          phone,
          deletedAt: null,
        },
        select: {
          id: true,
          balance: true,
          points: true,
          tier: true,
          createdAt: true,
        },
      }),
    ]);
    return this.buildSnapshot(storeId, member, marketingCustomer);
  }

  /** 组装快照：会员记录是门槛（无会员即视为非本店会员），顾客档案提供资产事实源 */
  private async buildSnapshot(
    storeId: number,
    member: ClubMemberAccountRecord | null,
    marketingCustomer: ClubMarketingCustomerRecord | null,
  ): Promise<ClubMemberSnapshot | null> {
    if (!member) {
      return null;
    }

    // 充值累计：通过 marketingRecharge 聚合计算该顾客在该门店的累计充值金额（分）
    const totalRechargeFen = await this.aggregateTotalRechargeAmount(
      marketingCustomer?.id ?? null,
    );

    const joinDate = this.resolveJoinDate(
      member.createdAt,
      marketingCustomer?.createdAt,
    );

    return {
      memberId: member.id,
      storeId,
      // 余额：来自 MarketingCustomer.balance（事实源）
      balance: Money.fromDbCents(
        marketingCustomer?.balance ?? 0,
      ).toOutputYuan(),
      // 等级：来自 MarketingCustomer.tier（事实源，Member.level 废弃）
      level: this.resolveLevel(marketingCustomer?.tier),
      // 积分：来自 MarketingCustomer.points（事实源，Member.points 废弃）
      points: marketingCustomer?.points ?? 0,
      memberCode: this.buildMemberCode(joinDate, member.id),
      joinDate,
      totalConsume: this.resolveTotalRecharge(totalRechargeFen),
    };
  }

  private async findCurrentMember(
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<ClubMemberAccountRecord | null> {
    return this.prisma.member.findFirst({
      where: {
        storeId,
        status: { not: MemberStatus.banned },
        deletedAt: null,
        OR: [
          { clubUserId },
          { phone, clubUserId: null },
        ],
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
  }

  private async findMarketingCustomer(
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<ClubMarketingCustomerRecord | null> {
    return this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        deletedAt: null,
        OR: [
          { clubUserId },
          { phone, clubUserId: null },
        ],
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

    // _sum.amount 返回 Prisma.Decimal | null，需显式转为 number
    return Number(result._sum.amount ?? 0);
  }

  private resolveLevel(
    marketingTier: string | undefined,
  ): ClubMemberHeldLevelValue {
    // 等级来自 MarketingCustomer.tier（唯一事实源）
    // Member.level 已废弃，不再读取
    switch (marketingTier) {
      case 'diamond':
        return 'diamond';
      case 'platinum':
        return 'platinum';
      case 'gold':
        return 'gold';
      default:
        // regular / undefined → regular
        return 'regular';
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

  /**
   * 解析累计充值金额（元）。
   *
   * 使用 marketingRecharge 聚合的充值累计（仅 type='recharge' 记录）；
   * 若无营销顾客档案，返回 0（Member.totalConsumeAmount 已废弃）。
   */
  private resolveTotalRecharge(totalRechargeFen: number | null): number {
    if (typeof totalRechargeFen === 'number') {
      return Money.fromDbCents(totalRechargeFen).toOutputYuan();
    }

    return 0;
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
