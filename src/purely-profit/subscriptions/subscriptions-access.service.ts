import { ForbiddenException, Injectable } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Injectable()
export class SubscriptionsAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureStoreAccessible(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: {
        id: storeId,
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
      select: { id: true },
    });

    if (!store) {
      throw new ForbiddenException('无权查看该门店套餐信息');
    }
  }

  async ensureStoreOwner(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, ownerId: user.id },
      select: { id: true },
    });

    if (!store) {
      throw new ForbiddenException('仅老板可调整门店套餐');
    }
  }
}
