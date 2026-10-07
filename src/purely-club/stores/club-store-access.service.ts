import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { buildClubMemberDisplayName } from '../../purely-profit/auth/auth.utils';
import { resolveStoreInviteQrPayload } from '../../purely-profit/stores/store-invite-code-qr.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ClubInviteAttributionService } from './club-invite-attribution.service';
import { ClubInviteCodeMapService } from './club-invite-code-map.service';
import {
  ClubMemberBindingService,
  type ClubMemberBindingResult,
} from './club-member-binding.service';
import {
  clubAccessibleStoreSelect,
  type ClubAccessibleStoreRecord,
} from './club-stores.types';

const CLUB_INVALID_INVITE_CODE_MESSAGE = '邀请码无效或门店不存在';
const CLUB_INVALID_SCAN_CODE_MESSAGE = '扫码结果无效，未识别到门店邀请码';
const CLUB_BANNED_MEMBER_MESSAGE =
  '当前账号已被该门店禁用，暂无法通过邀请码加入';
/** 用户可访问门店列表缓存的 Redis key 前缀 */
const CLUB_ACCESSIBLE_STORES_CACHE_KEY_PREFIX = 'club:accessible-stores:';
/** 用户可访问门店列表缓存 TTL（秒），60 秒后过期 */
const CLUB_ACCESSIBLE_STORES_CACHE_TTL_SECONDS = 60;

@Injectable()
export class ClubStoreAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly inviteCodeMapService: ClubInviteCodeMapService,
    private readonly inviteAttributionService: ClubInviteAttributionService,
    private readonly memberBindingService: ClubMemberBindingService,
  ) {}

  /**
   * 会员身份匹配条件：认出「当前登录者本人」在本店的会员档案。
   *
   * 两层语义，顺序不能反：
   *
   * 1. `clubUserId` —— 权威锚点。会员档案与账号一一对应，不受手机号变化影响
   *    （换绑后旧号码可能被他人注册，继续按 phone 匹配会命中**别人**的档案，
   *    门店与会员数据随之串号）。
   * 2. `(phone, clubUserId: null)` —— 历史无主档案的认领通道。
   *
   * 第 2 层的 `clubUserId: null` 限定是关键：同一门店可能存在两条相同手机号的
   * 会员档案，其中一条已归属他人。不限定的话 `some` 会把它一起命中，等于拿着
   * 别人的会员身份进店。宁可让无主档案继续无主，也不能认错人。
   *
   * 历史数据靠回填迁移（20261007000100）补齐 clubUserId；
   * 新数据由建档流程直接写入，终态全部收敛到第 1 层。
   */
  private buildMemberIdentityWhere(
    user: AuthenticatedUser,
  ): Prisma.MemberWhereInput {
    return {
      OR: [
        { clubUserId: user.id },
        { phone: this.resolveMemberPhone(user), clubUserId: null },
      ],
      status: { not: MemberStatus.banned },
    };
  }

  async findAccessibleStores(
    user: AuthenticatedUser,
  ): Promise<ClubAccessibleStoreRecord[]> {
    const cacheKey = `${CLUB_ACCESSIBLE_STORES_CACHE_KEY_PREFIX}${user.id}`;
    const cached =
      await this.redisService.getJson<ClubAccessibleStoreRecord[]>(cacheKey);
    if (cached && Array.isArray(cached)) {
      return cached;
    }

    const stores = await this.prisma.store.findMany({
      where: {
        deletedAt: null,
        members: {
          some: this.buildMemberIdentityWhere(user),
        },
      },
      select: clubAccessibleStoreSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    await this.redisService.setJson(
      cacheKey,
      stores,
      CLUB_ACCESSIBLE_STORES_CACHE_TTL_SECONDS,
    );
    return stores;
  }

  async findAccessibleStoreById(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<ClubAccessibleStoreRecord | null> {
    return this.prisma.store.findFirst({
      where: {
        id: storeId,
        deletedAt: null,
        members: {
          some: this.buildMemberIdentityWhere(user),
        },
      },
      select: clubAccessibleStoreSelect,
    });
  }

  async joinStoreByScanCode(
    user: AuthenticatedUser,
    scanCode: string,
  ): Promise<ClubAccessibleStoreRecord & { isNewMember: boolean }> {
    const resolveResult = resolveStoreInviteQrPayload(scanCode);
    if (resolveResult.kind !== 'recognized') {
      this.inviteAttributionService.logInviteScan(
        user.id,
        null,
        'not_found',
        scanCode,
      );
      throw new BadRequestException(CLUB_INVALID_SCAN_CODE_MESSAGE);
    }

    // 渠道二维码（带 token）已撤销时阻止入店
    const storeBeforeJoin =
      await this.inviteCodeMapService.findStoreByInviteCode(
        resolveResult.inviteCode,
      );
    if (storeBeforeJoin) {
      const attribution =
        await this.inviteAttributionService.resolveIssueScanAttribution(
          resolveResult.issueToken,
          storeBeforeJoin.id,
        );
      if (!attribution.continueScan) {
        throw new BadRequestException('该二维码已停用，请联系商家获取新二维码');
      }
    }

    // 判断是否为「拉新」（member 之前不存在），用于渠道归因 joinedCount
    const store = await this.joinStoreByInviteCode(
      user,
      resolveResult.inviteCode,
    );

    if (resolveResult.issueToken && storeBeforeJoin && !store.isNewMember) {
      await this.inviteAttributionService.incrementIssueJoinedCount(
        resolveResult.issueToken,
        store.id,
      );
    }

    this.inviteAttributionService.logInviteScan(
      user.id,
      store.id,
      resolveResult.protocolVersion,
      scanCode,
    );
    return store;
  }

  async joinStoreByInviteCode(
    user: AuthenticatedUser,
    inviteCode: string,
  ): Promise<ClubAccessibleStoreRecord & { isNewMember: boolean }> {
    const normalizedInviteCode = this.normalizeInviteCode(inviteCode);
    if (!normalizedInviteCode) {
      throw new BadRequestException('门店邀请码不能为空');
    }

    const store =
      await this.inviteCodeMapService.findStoreByInviteCode(
        normalizedInviteCode,
      );
    if (!store) {
      throw new NotFoundException(CLUB_INVALID_INVITE_CODE_MESSAGE);
    }

    const memberPhone = this.resolveMemberPhone(user);

    const existingMember = await this.prisma.member.findFirst({
      where: {
        storeId: store.id,
        phone: memberPhone,
        deletedAt: null,
      },
      select: {
        status: true,
      },
    });
    if (existingMember?.status === MemberStatus.banned) {
      throw new ForbiddenException(CLUB_BANNED_MEMBER_MESSAGE);
    }

    const displayName = this.resolveDisplayName(user);
    // 必须传 user.id：顾客档案要带上 club_user_id 才能被稳定定位。
    // 缺省时换绑手机号（ClubPhoneRebindService.syncPhoneAcrossProfiles 按 clubUserId 定位）
    // 会漏掉这家店，用户换号后当场失去刚加入的门店。
    const bindingResult =
      await this.memberBindingService.upsertMemberAndCustomer(
        store.id,
        memberPhone,
        displayName,
        user.id,
      );

    // 加入门店后清除该用户的可访问门店缓存，确保下次请求拉取最新数据
    await this.invalidateAccessibleStoresCache(user.id);

    return { ...store, isNewMember: bindingResult.isNewMember };
  }

  /**
   * 确保用户与指定门店之间存在会员关系。
   *
   * 与 `joinStoreByInviteCode` 的差异仅在「门店从哪来」：inviteCode 来自二维码，
   * 本方法的 storeId 由调用方提供（如桌码解析出的门店）。档案同步逻辑完全复用，
   * 保证两条入店路径写出的数据语义一致。
   *
   * 用于「扫码点餐」这类**先确定门店、后补会员关系**的场景。缺失该关系会导致：
   * - 商家端（purelyProfit）看不到该顾客档案与手机号；
   * - `/club/member/account` 等以「当前门店」为前提的接口 404——
   *   `findAccessibleStores` 按 `Member.phone` 匹配，没有 Member 就没有可访问门店。
   */
  async ensureStoreMembership(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<ClubMemberBindingResult> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('门店不存在');
    }

    const bindingResult =
      await this.memberBindingService.upsertMemberAndCustomer(
        store.id,
        this.resolveMemberPhone(user),
        this.resolveDisplayName(user),
        user.id,
      );

    await this.invalidateAccessibleStoresCache(user.id);

    return bindingResult;
  }

  /**
   * 清除用户可访问门店列表的 Redis 缓存。
   *
   * 在「会员关系可能变化」时调用（加入门店、补齐会员关系、换绑手机号），
   * 确保下次请求获取最新数据，而不是等 60 秒 TTL 自然过期。
   */
  async invalidateAccessibleStoresCache(userId: number): Promise<void> {
    await this.redisService.del(
      `${CLUB_ACCESSIBLE_STORES_CACHE_KEY_PREFIX}${userId}`,
    );
  }

  /**
   * 解析用于 Member / MarketingCustomer 表的 phone 值。
   *
   * 对于微信无手机号用户（phone 格式为 club_wechat:xxx），
   * 使用 email 中的稳定标识符代替，避免 phone 字段语义混乱及后续账号合并时数据断裂。
   * 对于手机号登录用户，直接使用 user.phone。
   */
  private resolveMemberPhone(user: AuthenticatedUser): string {
    return user.phone;
  }

  private normalizeInviteCode(inviteCode: string): string {
    return inviteCode.trim().toUpperCase();
  }

  private resolveDisplayName(user: AuthenticatedUser): string {
    return buildClubMemberDisplayName(user.phone, user.name);
  }
}
