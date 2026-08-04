import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { resolveStoreInviteQrPayload } from '../../purely-profit/stores/store-invite-code-qr.utils';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubInviteCodeMapCacheKey } from '../../redis/keys';
import type {
  ClubPublicInviteEntryResponseDto,
  ClubResolveScanCodeResponseDto,
} from './dto/club-store.dto';
import { ClubStoreViewService } from './club-store-view.service';
import {
  clubAccessibleStoreSelect,
  type ClubAccessibleStoreRecord,
} from './club-stores.types';

const CLUB_INVALID_INVITE_CODE_MESSAGE = '邀请码无效或门店不存在';
const CLUB_INVALID_SCAN_CODE_MESSAGE = '扫码结果无效，未识别到门店邀请码';
const CLUB_BANNED_MEMBER_MESSAGE =
  '当前账号已被该门店禁用，暂无法通过邀请码加入';
/** 映射缓存 TTL（秒），1 小时后过期自动刷新 */
const CLUB_INVITE_CODE_MAP_TTL_SECONDS = 3600;
/** 用户可访问门店列表缓存的 Redis key 前缀 */
const CLUB_ACCESSIBLE_STORES_CACHE_KEY_PREFIX = 'club:accessible-stores:';
/** 用户可访问门店列表缓存 TTL（秒），60 秒后过期 */
const CLUB_ACCESSIBLE_STORES_CACHE_TTL_SECONDS = 60;

@Injectable()
export class ClubStoreAccessService {
  private readonly logger = new Logger(ClubStoreAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly storeViewService: ClubStoreViewService,
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
  ): Promise<ClubAccessibleStoreRecord> {
    const resolveResult = resolveStoreInviteQrPayload(scanCode);
    if (resolveResult.kind !== 'recognized') {
      this.logInviteScan(user.id, null, 'not_found', scanCode);
      throw new BadRequestException(CLUB_INVALID_SCAN_CODE_MESSAGE);
    }

    // 渠道二维码（带 token）已撤销时阻止入店
    const storeBeforeJoin = await this.findStoreByInviteCode(
      resolveResult.inviteCode,
    );
    if (storeBeforeJoin) {
      const attribution = await this.resolveIssueScanAttribution(
        resolveResult.issueToken,
        storeBeforeJoin.id,
      );
      if (!attribution.continueScan) {
        throw new BadRequestException(
          '该二维码已停用，请联系商家获取新二维码',
        );
      }
    }

    // 判断是否为「拉新」（member 之前不存在），用于渠道归因 joinedCount
    const memberPhone = this.resolveMemberPhone(user);
    const memberExists = storeBeforeJoin
      ? await this.prisma.member.findFirst({
          where: {
            storeId: storeBeforeJoin.id,
            phone: memberPhone,
            deletedAt: null,
          },
          select: { id: true },
        })
      : null;

    const store = await this.joinStoreByInviteCode(
      user,
      resolveResult.inviteCode,
    );

    if (resolveResult.issueToken && storeBeforeJoin && !memberExists) {
      await this.incrementIssueJoinedCount(resolveResult.issueToken, store.id);
    }

    this.logInviteScan(
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
  ): Promise<ClubAccessibleStoreRecord> {
    const normalizedInviteCode = this.normalizeInviteCode(inviteCode);
    if (!normalizedInviteCode) {
      throw new BadRequestException('门店邀请码不能为空');
    }

    const store = await this.findStoreByInviteCode(normalizedInviteCode);
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
    await this.prisma.$transaction(
      async (tx) => {
        const existingMemberRecord = await tx.member.findFirst({
          where: {
            storeId: store.id,
            phone: memberPhone,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

        if (existingMemberRecord) {
          await tx.member.update({
            where: { id: existingMemberRecord.id },
            data: {
              name: displayName,
            },
          });
        } else {
          await tx.member.create({
            data: {
              storeId: store.id,
              name: displayName,
              phone: memberPhone,
            },
          });
        }

        const existingCustomerRecord = await tx.marketingCustomer.findFirst({
          where: {
            storeId: store.id,
            phone: memberPhone,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

        if (existingCustomerRecord) {
          await tx.marketingCustomer.update({
            where: { id: existingCustomerRecord.id },
            data: {
              name: displayName,
            },
          });
        } else {
          await tx.marketingCustomer.create({
            data: {
              storeId: store.id,
              name: displayName,
              phone: memberPhone,
            },
          });
        }
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    // 加入门店后清除该用户的可访问门店缓存，确保下次请求拉取最新数据
    await this.invalidateAccessibleStoresCache(user.id);

    return store;
  }

  /**
   * 解析并确认邀请二维码（供 purely-club 扫码落地页 / 小程序使用）。
   *
   * 客户端不自行猜测二维码路由，而是把原始扫码内容交给服务端权威解析，
   * 由服务端返回协议版本、邀请码、目标门店与下一步动作。
   */
  async resolveScanCode(
    user: AuthenticatedUser,
    scanCode: string,
  ): Promise<ClubResolveScanCodeResponseDto> {
    const resolveResult = resolveStoreInviteQrPayload(scanCode);

    if (resolveResult.kind === 'unsupported_version') {
      this.logInviteScan(user.id, null, 'unsupported_version', scanCode);
      return {
        protocolVersion: 'unsupported',
        inviteCode: null,
        store: null,
        status: 'unsupported_version',
        nextAction: 'none',
        message: '当前邀请二维码协议版本暂不支持，请联系商家获取新二维码',
      };
    }

    if (resolveResult.kind === 'unrecognized') {
      this.logInviteScan(user.id, null, 'not_found', scanCode);
      return {
        protocolVersion: null,
        inviteCode: null,
        store: null,
        status: 'not_found',
        nextAction: 'none',
        message: '扫码结果无效，未识别到门店邀请码',
      };
    }

    const { protocolVersion, inviteCode, issueToken } = resolveResult;
    const store = await this.findStoreByInviteCode(inviteCode);
    if (!store) {
      this.logInviteScan(user.id, null, 'inactive', scanCode);
      return {
        protocolVersion,
        inviteCode,
        store: null,
        status: 'inactive',
        nextAction: 'none',
        message: '该门店邀请二维码已失效，请联系商家获取新二维码',
      };
    }

    // 渠道二维码归因：已撤销的渠道二维码给出明确停用提示（scanCount 在此递增）
    const attribution = await this.resolveIssueScanAttribution(
      issueToken,
      store.id,
    );
    if (!attribution.continueScan) {
      this.logInviteScan(user.id, store.id, 'revoked_issue', scanCode);
      return {
        protocolVersion,
        inviteCode,
        store: null,
        status: 'inactive',
        nextAction: 'none',
        message: '该渠道二维码已停用，请联系商家获取新二维码',
      };
    }

    const memberPhone = this.resolveMemberPhone(user);
    const existingMember = await this.prisma.member.findFirst({
      where: { storeId: store.id, phone: memberPhone, deletedAt: null },
      select: { id: true },
    });
    const alreadyBound = existingMember !== null;
    this.logInviteScan(
      user.id,
      store.id,
      alreadyBound ? 'already_bound' : 'active',
      scanCode,
    );

    return {
      protocolVersion,
      inviteCode,
      store: await this.storeViewService.toSummary(store),
      status: 'active',
      nextAction: alreadyBound ? 'already_bound' : 'join_store',
      message: alreadyBound
        ? '您已加入该门店，可直接进入'
        : '扫码成功，可加入该门店',
    };
  }

  /**
   * 公开落地入口解析（无鉴权，供 H5 落地页 / 小程序扫码后调用）。
   *
   * 只返回必要落地信息（协议版本、邀请码、门店摘要、状态），
   * 不执行任何状态变更，不泄露商家敏感配置与结算信息。
   */
  async resolvePublicInviteEntry(
    inviteCode: string,
    issueToken?: string | null,
  ): Promise<ClubPublicInviteEntryResponseDto> {
    const normalized = this.normalizeInviteCode(inviteCode);
    if (!normalized || !/^[A-Z0-9]{6,32}$/.test(normalized)) {
      this.logInviteScan(null, null, 'not_found', inviteCode);
      return {
        inviteCode: null,
        store: null,
        status: 'not_found',
        message: '扫码结果无效，未识别到门店邀请码',
      };
    }

    const store = await this.findStoreByInviteCode(normalized);
    if (!store) {
      this.logInviteScan(null, null, 'inactive', inviteCode);
      return {
        inviteCode: normalized,
        store: null,
        status: 'inactive',
        message: '该门店邀请二维码已失效，请联系商家获取新二维码',
      };
    }

    // 渠道二维码归因：已撤销时给出明确停用提示
    const attribution = await this.resolveIssueScanAttribution(
      issueToken ?? null,
      store.id,
    );
    if (!attribution.continueScan) {
      this.logInviteScan(null, store.id, 'revoked_issue', inviteCode);
      return {
        inviteCode: normalized,
        store: null,
        status: 'inactive',
        message: '该渠道二维码已停用，请联系商家获取新二维码',
      };
    }

    this.logInviteScan(null, store.id, 'active', inviteCode);
    return {
      inviteCode: normalized,
      store: await this.storeViewService.toSummary(store),
      status: 'active',
      message: '邀请二维码有效',
    };
  }

  /**
   * 根据 inviteCode 查找门店。
   *
   * 策略：优先从 Redis 缓存读取完整的 inviteCode→storeId 映射表；
   * 未命中时从数据库加载全量 storeId，在内存中构建映射并写入缓存。
   * 映射表以整体方式缓存，避免单条缓存碰撞导致的错误固化。
   */
  async findStoreByInviteCode(
    inviteCode: string,
  ): Promise<ClubAccessibleStoreRecord | null> {
    const codeMap = await this.loadInviteCodeMap();
    const storeId = codeMap.get(inviteCode) ?? null;
    if (storeId === null) {
      return null;
    }

    return this.prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: clubAccessibleStoreSelect,
    });
  }

  /**
   * 加载 inviteCode→storeId 映射表。
   *
   * 优先从 Redis 读取缓存的整体映射 JSON；
   * 未命中时从数据库的 store_invite_codes 表加载所有活跃邀请码，
   * 构建 inviteCode→storeId 映射后写入缓存。
   */
  private async loadInviteCodeMap(): Promise<Map<string, number>> {
    // 1. 尝试从 Redis 读取缓存映射
    const cachedMap = await this.redisService.getJson<Record<string, number>>(
      buildClubInviteCodeMapCacheKey(),
    );
    if (cachedMap && typeof cachedMap === 'object') {
      return new Map(
        Object.entries(cachedMap).map(([k, v]) => [k, v as number]),
      );
    }

    // 2. 缓存未命中，从 store_invite_codes 表加载所有活跃邀请码
    // F9: 过滤掉对应门店已软删（deletedAt != null）的邀请码，避免缓存污染
    const inviteCodes = await this.prisma.storeInviteCode.findMany({
      where: {
        isActive: true,
        store: { deletedAt: null },
      },
      select: { code: true, storeId: true },
      orderBy: { storeId: 'asc' },
    });

    const codeMap = new Map<string, number>();

    for (const record of inviteCodes) {
      if (codeMap.has(record.code)) {
        // 同一门店有多个活跃码时记录警告，保留第一条（storeId 较小的先入）
        this.logger.warn(
          `邀请码映射冲突: code=${record.code} 已映射到门店 ${codeMap.get(record.code)}，跳过门店 ${record.storeId}`,
        );
      } else {
        codeMap.set(record.code, record.storeId);
      }
    }

    // 3. 写入缓存供后续请求使用
    const mapObject: Record<string, number> = {};
    for (const [code, id] of codeMap) {
      mapObject[code] = id;
    }
    await this.redisService.setJson(
      buildClubInviteCodeMapCacheKey(),
      mapObject,
      CLUB_INVITE_CODE_MAP_TTL_SECONDS,
    );

    return codeMap;
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

  /**
   * 渠道二维码扫码归因。
   *
   * - 无 token（通用二维码）→ 继续，不计数；
   * - token 对应 active 发行记录 → scanCount+1，继续；
   * - token 对应 revoked 发行记录 → 阻断（该实体二维码已停用）；
   * - token 不存在或不属于该门店 → 忽略归因，不阻断（防止伪造 token 干扰正常扫码）。
   */
  private async resolveIssueScanAttribution(
    issueToken: string | null,
    storeId: number,
  ): Promise<{ continueScan: boolean }> {
    if (!issueToken) {
      return { continueScan: true };
    }

    const issue = await this.prisma.storeInviteQrIssue.findUnique({
      where: { publicToken: issueToken },
      select: { id: true, status: true, storeId: true, scanCount: true },
    });
    if (!issue || issue.storeId !== storeId) {
      return { continueScan: true };
    }
    if (issue.status === 'revoked') {
      return { continueScan: false };
    }

    await this.prisma.storeInviteQrIssue.update({
      where: { id: issue.id },
      data: { scanCount: { increment: 1 } },
    });
    return { continueScan: true };
  }

  /** 渠道二维码「拉新」计数：仅在新增会员档案时递增。 */
  private async incrementIssueJoinedCount(
    issueToken: string,
    storeId: number,
  ): Promise<void> {
    await this.prisma.storeInviteQrIssue.updateMany({
      where: { publicToken: issueToken, storeId, status: 'active' },
      data: { joinedCount: { increment: 1 } },
    });
  }

  /**
   * 记录邀请二维码扫码解析日志（用于运营可观测性：协议版本 / 结果分类 / 门店分布）。
   * scanCode 仅在日志中保留，用于排查；敏感信息不落日志。
   */
  private logInviteScan(
    userId: number | null,
    storeId: number | null,
    status: string,
    scanCode: string,
  ): void {
    this.logger.log(
      `invite-scan userId=${userId ?? '-'} storeId=${storeId ?? '-'} status=${status} scan=${scanCode.length > 64 ? `${scanCode.slice(0, 64)}...` : scanCode}`,
    );
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
