import { CLUB_MEMBER_ERROR_CODE, clubMemberError } from '../club-member.errors';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { formatShanghaiDateKey } from '../../../shared/shanghai-time.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisReadPrefetchService } from '../../../redis/redis-read-prefetch.service';
import { RedisService } from '../../../redis/redis.service';
import { buildClubMemberSnapshotCacheKey } from '../../../redis/keys/club-cache-keys';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import type { ClubMemberHeldLevelValue } from '../dto/club-member-account.dto';
import {
  MISS_SENTINEL,
  type ClubMarketingCustomerRecord,
  type ClubMemberAccountRecord,
  type ClubMemberSnapshot,
  type ClubMemberSnapshotCacheValue,
} from './club-member-profile.types';

export type { ClubMemberSnapshot };

const CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE = '当前门店暂无会员账户信息';

/** 会员快照缓存 TTL（秒） */
const CLUB_MEMBER_SNAPSHOT_CACHE_TTL_SECONDS = 15;
/** null 快照缓存 TTL（秒）：防穿透，比正常 TTL 更短 */
const CLUB_MEMBER_SNAPSHOT_NULL_CACHE_TTL_SECONDS = 5;

@Injectable()
export class ClubMemberProfileService {
  private readonly logger = new Logger(ClubMemberProfileService.name);

  /**
   * 同一 (storeId, clubUserId) 的在途快照解析共享一个 Promise。
   *
   * 首页账户与商品定价会并发解析同一份快照，15s 缓存要等首次写回后才命中，
   * 冷启动 / 缓存失效瞬间两个分支会各跑一遍档案定位与充值聚合。
   * 仅进程内生效（cluster 多 worker 各自独立），Promise 结束即清理，
   * 不作为时间缓存使用，数据可见性仍由 15s TTL 与主动失效负责。
   */
  private readonly inflightSnapshots = new Map<
    string,
    Promise<ClubMemberSnapshot | null>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly redisReadPrefetch: RedisReadPrefetchService,
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
      throw new NotFoundException(
        clubMemberError(
          CLUB_MEMBER_ERROR_CODE.RESOURCE_ACCOUNT_NOT_FOUND,
          CLUB_MEMBER_ACCOUNT_NOT_FOUND_MESSAGE,
        ),
      );
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
    const cacheKey = buildClubMemberSnapshotCacheKey(storeId, clubUserId);
    const inflight = this.inflightSnapshots.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const request = this.loadSnapshot(
      cacheKey,
      storeId,
      clubUserId,
      phone,
    ).finally(() => {
      this.inflightSnapshots.delete(cacheKey);
    });
    this.inflightSnapshots.set(cacheKey, request);

    return request;
  }

  /** 缓存读取 + 档案定位 + 回写，仅供 getSnapshotByStoreIdentity 经并发去重后调用。 */
  private async loadSnapshot(
    cacheKey: string,
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<ClubMemberSnapshot | null> {
    // 读缓存：门店+用户粒度，TTL 15s
    const cached = await this.readSnapshotCache(cacheKey);
    if (cached !== null) {
      return 'found' in cached ? null : cached;
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

    // 写缓存：有快照写 15s，空结果写哨兵 5s 防穿透
    //
    // 回写不阻塞返回：缓存写的成败不影响本次数据的正确性（失败只是下次再回源），
    // 却会被算进读接口的响应延迟。首页 / 账户 / 商品定价三处共用本快照，
    // 冷启动那一次请求原先要把一次 Redis SET 往返加在 DB 定位 + 聚合之后。
    const ttl =
      snapshot !== null
        ? CLUB_MEMBER_SNAPSHOT_CACHE_TTL_SECONDS
        : CLUB_MEMBER_SNAPSHOT_NULL_CACHE_TTL_SECONDS;
    void this.persistSnapshotCache(cacheKey, snapshot ?? MISS_SENTINEL, ttl);

    return snapshot;
  }

  /** 异步回写会员快照缓存：失败只记 warn，降级为「下次回源」 */
  private async persistSnapshotCache(
    cacheKey: string,
    value: ClubMemberSnapshotCacheValue,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redisService.setJson(cacheKey, value, ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `会员快照缓存回写失败 key=${cacheKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 读取快照缓存，优先消费请求级预取结果。
   *
   * 快照 key 只由 `(storeId, clubUserId)` 决定，聚合入口可预取；预取未覆盖
   * 本 key 或预取失败时回退单条 GET，语义与直接读缓存完全一致。
   */
  private async readSnapshotCache(
    cacheKey: string,
  ): Promise<ClubMemberSnapshotCacheValue | null> {
    const prefetched =
      await this.redisReadPrefetch.peekJson<ClubMemberSnapshotCacheValue>(
        cacheKey,
      );
    return prefetched !== undefined
      ? prefetched
      : this.redisService.getJson<ClubMemberSnapshotCacheValue>(cacheKey);
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
      customerId: marketingCustomer?.id ?? null,
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

  /**
   * 会员 / 顾客档案统一采用与 ClubPointsQueryService.findCustomerByStoreAndPhone
   * 相同的两段锚定：先命中当前用户绑定档案，再回落「手机号 + clubUserId:null」无主档案。
   * 原 OR + findFirst 无排序时，同店同号多条档案可能命中无主档案，导致签到加分的
   * MarketingCustomer 与首页账户接口读取的不是同一条，出现积分不可见 / 回退。
   */
  private async findCurrentMember(
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<ClubMemberAccountRecord | null> {
    const bound = await this.prisma.member.findFirst({
      where: {
        storeId,
        clubUserId,
        status: { not: MemberStatus.banned },
        deletedAt: null,
      },
      select: { id: true, createdAt: true },
    });
    if (bound) {
      return bound;
    }
    return this.prisma.member.findFirst({
      where: {
        storeId,
        phone,
        clubUserId: null,
        status: { not: MemberStatus.banned },
        deletedAt: null,
      },
      select: { id: true, createdAt: true },
    });
  }

  private async findMarketingCustomer(
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<ClubMarketingCustomerRecord | null> {
    const bound = await this.prisma.marketingCustomer.findFirst({
      where: { storeId, clubUserId, deletedAt: null },
      select: {
        id: true,
        balance: true,
        points: true,
        tier: true,
        createdAt: true,
      },
    });
    if (bound) {
      return bound;
    }
    return this.prisma.marketingCustomer.findFirst({
      where: { storeId, phone, clubUserId: null, deletedAt: null },
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
    return formatShanghaiDateKey(joinedAt.getTime());
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
}
