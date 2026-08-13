import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { resolveStoreInviteQrPayload } from '../../purely-profit/stores/store-invite-code-qr.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ClubInviteAttributionService } from './club-invite-attribution.service';
import { ClubInviteCodeMapService } from './club-invite-code-map.service';
import { ClubMemberBindingService } from './club-member-binding.service';
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
          some: {
            phone: this.resolveMemberPhone(user),
            status: { not: MemberStatus.banned },
          },
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
          some: {
            phone: this.resolveMemberPhone(user),
            status: { not: MemberStatus.banned },
          },
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
    const bindingResult =
      await this.memberBindingService.upsertMemberAndCustomer(
        store.id,
        memberPhone,
        displayName,
      );

    // 加入门店后清除该用户的可访问门店缓存，确保下次请求拉取最新数据
    await this.invalidateAccessibleStoresCache(user.id);

    return { ...store, isNewMember: bindingResult.isNewMember };
  }

  /**
   * 清除用户可访问门店列表的 Redis 缓存。
   * 在门店成员关系变更时调用（如加入门店），确保下次请求获取最新数据。
   */
  private async invalidateAccessibleStoresCache(userId: number): Promise<void> {
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
    const trimmedName = (user.name ?? '').trim();
    if (trimmedName.length > 0) {
      return trimmedName;
    }

    // 微信无手机号用户使用 openid 后4位，手机号用户使用手机号后4位
    const suffix = user.phone.startsWith('club_wechat:')
      ? user.phone.slice(-4)
      : user.phone.slice(-4);
    return `纯利会员${suffix}`;
  }
}
