import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessControlService } from '../access-control/access-control.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Injectable()
export class SubscriptionsAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async ensureStoreAccessible(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<void> {
    const accessibleStoreId =
      this.accessControlService.resolveCurrentStoreIdByPermission(
        user,
        'subscription:view',
      );

    if (accessibleStoreId !== storeId) {
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
