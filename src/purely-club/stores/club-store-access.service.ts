import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  buildStoreInviteCode,
  resolveInviteCodeFromClubStoreScanCode,
} from '../../purely-profit/member/platform-membership/membership-profile.mapper';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  clubAccessibleStoreSelect,
  type ClubAccessibleStoreRecord,
} from './club-stores.types';

const CLUB_INVALID_INVITE_CODE_MESSAGE = '邀请码无效或门店不存在';
const CLUB_INVALID_SCAN_CODE_MESSAGE = '扫码结果无效，未识别到门店邀请码';
const CLUB_BANNED_MEMBER_MESSAGE =
  '当前账号已被该门店禁用，暂无法通过邀请码加入';

@Injectable()
export class ClubStoreAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async findAccessibleStores(
    user: AuthenticatedUser,
  ): Promise<ClubAccessibleStoreRecord[]> {
    return this.prisma.store.findMany({
      where: {
        members: {
          some: {
            phone: user.phone,
            status: { not: MemberStatus.BANNED },
          },
        },
      },
      select: clubAccessibleStoreSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findAccessibleStoreById(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<ClubAccessibleStoreRecord | null> {
    return this.prisma.store.findFirst({
      where: {
        id: storeId,
        members: {
          some: {
            phone: user.phone,
            status: { not: MemberStatus.BANNED },
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

    const existingMember = await this.prisma.member.findUnique({
      where: {
        storeId_phone: {
          storeId: store.id,
          phone: user.phone,
        },
      },
      select: {
        status: true,
      },
    });
    if (existingMember?.status === MemberStatus.BANNED) {
      throw new ForbiddenException(CLUB_BANNED_MEMBER_MESSAGE);
    }

    const displayName = this.resolveDisplayName(user);
    await this.prisma.$transaction([
      this.prisma.member.upsert({
        where: {
          storeId_phone: {
            storeId: store.id,
            phone: user.phone,
          },
        },
        create: {
          storeId: store.id,
          name: displayName,
          phone: user.phone,
        },
        update: {},
      }),
      this.prisma.marketingCustomer.upsert({
        where: {
          storeId_phone: {
            storeId: store.id,
            phone: user.phone,
          },
        },
        create: {
          storeId: store.id,
          name: displayName,
          phone: user.phone,
        },
        update: {},
      }),
    ]);

    return store;
  }

  /**
   * 根据邀请码反查门店。
   *
   * 优化策略：先从 Redis 缓存反查，命中则直接用 storeId 查记录；
   * 未命中时遍历 storeId 范围做 buildStoreInviteCode 反推（避免全表加载到内存），
   * 找到后写入缓存供后续请求直接命中。
   */
  private async findStoreByInviteCode(
    inviteCode: string,
  ): Promise<ClubAccessibleStoreRecord | null> {
    // 1. 尝试从 Redis 缓存反查
    const cachedStoreId = await this.loadCachedStoreIdByInviteCode(inviteCode);
    if (cachedStoreId !== null) {
      return this.prisma.store.findFirst({
        where: { id: cachedStoreId },
        select: clubAccessibleStoreSelect,
      });
    }

    // 2. 缓存未命中，遍历 storeId 范围反推
    const maxStore = await this.prisma.store.findFirst({
      select: { id: true },
      orderBy: { id: 'desc' },
    });
    const maxId = maxStore?.id ?? 0;

    let matchedStoreId: number | null = null;
    for (let id = 1; id <= maxId; id += 1) {
      if (buildStoreInviteCode(id) === inviteCode) {
        matchedStoreId = id;
        break;
      }
    }

    if (matchedStoreId === null) {
      return null;
    }

    // 3. 写入缓存供后续请求使用
    await this.cacheStoreIdByInviteCode(inviteCode, matchedStoreId);

    return this.prisma.store.findFirst({
      where: { id: matchedStoreId },
      select: clubAccessibleStoreSelect,
    });
  }

  private async loadCachedStoreIdByInviteCode(
    inviteCode: string,
  ): Promise<number | null> {
    const raw = await this.redisService.get(
      `club:invite-code:${inviteCode}`,
    );
    if (!raw) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private async cacheStoreIdByInviteCode(
    inviteCode: string,
    storeId: number,
  ): Promise<void> {
    // 缓存 24 小时，inviteCode→storeId 映射不会变化
    await this.redisService.set(
      `club:invite-code:${inviteCode}`,
      `${storeId}`,
      86400,
    );
  }

  private normalizeInviteCode(inviteCode: string): string {
    return inviteCode.trim().toUpperCase();
  }

  private resolveDisplayName(user: AuthenticatedUser): string {
    const trimmedName = (user.name || '').trim();
    if (trimmedName.length > 0) {
      return trimmedName;
    }

    return `纯利会员${user.phone.slice(-4)}`;
  }
}
