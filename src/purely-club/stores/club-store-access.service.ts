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
import {
  clubAccessibleStoreSelect,
  type ClubAccessibleStoreRecord,
} from './club-stores.types';

const CLUB_INVALID_INVITE_CODE_MESSAGE = '邀请码无效或门店不存在';
const CLUB_INVALID_SCAN_CODE_MESSAGE = '扫码结果无效，未识别到门店邀请码';
const CLUB_BANNED_MEMBER_MESSAGE = '当前账号已被该门店禁用，暂无法通过邀请码加入';

@Injectable()
export class ClubStoreAccessService {
  constructor(private readonly prisma: PrismaService) {}

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

  private async findStoreByInviteCode(
    inviteCode: string,
  ): Promise<ClubAccessibleStoreRecord | null> {
    const stores = await this.prisma.store.findMany({
      select: clubAccessibleStoreSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    return (
      stores.find((store) => buildStoreInviteCode(store.id) === inviteCode) ?? null
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
