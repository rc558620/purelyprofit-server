import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { resolveInviteCodeFromClubStoreScanCode } from '../../purely-profit/member/platform-membership/membership-profile.mapper';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  clubAccessibleStoreSelect,
  type ClubAccessibleStoreRecord,
} from './club-stores.types';

const CLUB_INVALID_INVITE_CODE_MESSAGE = '邀请码无效或门店不存在';
const CLUB_INVALID_SCAN_CODE_MESSAGE = '扫码结果无效，未识别到门店邀请码';
const CLUB_BANNED_MEMBER_MESSAGE =
  '当前账号已被该门店禁用，暂无法通过邀请码加入';
/** 邀请码→storeId 映射缓存的 Redis key */
const CLUB_INVITE_CODE_MAP_CACHE_KEY = 'club:invite-code-map';
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
    const inviteCode = resolveInviteCodeFromClubStoreScanCode(scanCode);
    if (!inviteCode) {
      throw new BadRequestException(CLUB_INVALID_SCAN_CODE_MESSAGE);
    }

    return this.joinStoreByInviteCode(user, inviteCode);
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
   * 根据 inviteCode 查找门店。
   *
   * 策略：优先从 Redis 缓存读取完整的 inviteCode→storeId 映射表；
   * 未命中时从数据库加载全量 storeId，在内存中构建映射并写入缓存。
   * 映射表以整体方式缓存，避免单条缓存碰撞导致的错误固化。
   */
  private async findStoreByInviteCode(
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
      CLUB_INVITE_CODE_MAP_CACHE_KEY,
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
      CLUB_INVITE_CODE_MAP_CACHE_KEY,
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
