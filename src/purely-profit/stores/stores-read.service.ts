import { Injectable, NotFoundException } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  StoreRecordSnapshot,
  StoreResponseDto,
} from './dto/store-response.dto';
import { StoresProfileService } from './stores-profile.service';

@Injectable()
export class StoresReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storesProfileService: StoresProfileService,
  ) {}

  async getStore(user: AuthenticatedUser): Promise<StoreResponseDto> {
    const store = await this.getBoundStoreRecordOrThrow(user);
    return this.storesProfileService.mapStoreResponse(store);
  }

  getCurrent(user: AuthenticatedUser): Promise<StoreResponseDto> {
    return this.getStore(user);
  }

  async getBoundStoreRecordOrThrow(
    user: AuthenticatedUser,
  ): Promise<StoreRecordSnapshot> {
    const store = await this.findBoundStoreRecord(user);

    if (!store) {
      throw new NotFoundException('当前账号暂无门店');
    }

    return store;
  }

  findBoundStoreRecord(
    user: AuthenticatedUser,
  ): Promise<StoreRecordSnapshot | null> {
    if (user.currentMembership?.storeId) {
      return this.prisma.store.findUnique({
        where: { id: user.currentMembership.storeId },
        select: {
          id: true,
          name: true,
          address: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    return this.prisma.store.findFirst({
      where: {
        OR: [
          { ownerId: user.id },
          {
            staffs: {
              some: {
                isActive: true,
                status: StaffStatus.ACTIVE,
                OR: [
                  { userId: user.id },
                  { email: user.email },
                  { phone: user.phone },
                ],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        address: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  }
}
