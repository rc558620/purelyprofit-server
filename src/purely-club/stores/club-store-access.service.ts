import { Injectable } from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  clubAccessibleStoreSelect,
  type ClubAccessibleStoreRecord,
} from './club-stores.types';

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
}
