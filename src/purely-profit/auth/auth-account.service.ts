import { Injectable } from '@nestjs/common';
import type { AccountIdentifiers } from './auth-account.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthStaffActivationService } from './auth-staff-activation.service';

@Injectable()
export class AuthAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authStaffActivationService: AuthStaffActivationService,
  ) {}

  async syncStaffMemberships(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    await this.writeStaffMemberships(userId, identifiers);
    await this.authStaffActivationService.activateInvitedStaffMemberships(
      userId,
      identifiers,
    );
  }

  private async writeStaffMemberships(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    // 仅回填该用户拥有所有权或已存在身份的门店，防止跨门店错误回填
    const legitimateStoreIds = await this.prisma.store
      .findMany({
        where: {
          OR: [
            { ownerId: userId, deletedAt: null },
            { staffs: { some: { userId, isActive: true } } },
          ],
        },
        select: { id: true },
      })
      .then((stores) => stores.map((s) => s.id));

    if (legitimateStoreIds.length === 0) {
      return;
    }

    await this.prisma.staff.updateMany({
      where: {
        userId: null,
        storeId: { in: legitimateStoreIds },
        OR: [{ email: identifiers.email }, { phone: identifiers.phone }],
      },
      data: {
        userId,
      },
    });
  }
}
