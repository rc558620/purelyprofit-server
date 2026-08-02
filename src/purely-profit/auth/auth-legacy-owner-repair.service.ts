import { Injectable, Logger } from '@nestjs/common';
import { StaffRole, StaffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from './strategies/jwt.strategy';

/**
 * 遗留店主会员补齐：老店主账号仅存在 stores.ownerId 时，
 * 自动补齐对应的 owner staff 记录，避免历史数据导致无法登录。
 */
@Injectable()
export class AuthLegacyOwnerRepairService {
  private readonly logger = new Logger(AuthLegacyOwnerRepairService.name);

  constructor(private readonly prisma: PrismaService) {}

  async repairLegacyOwnerMembership(
    payload: JwtPayload,
    userEmail: string,
  ): Promise<boolean> {
    const ownerStore = await this.prisma.store.findFirst({
      where: { ownerId: payload.sub, deletedAt: null },
      select: {
        id: true,
        owner: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    if (!ownerStore) {
      return false;
    }

    const existingStaff = await this.prisma.staff.findFirst({
      where: {
        OR: [
          { userId: payload.sub },
          { email: userEmail },
          { phone: payload.phone },
        ],
      },
      select: {
        id: true,
        storeId: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    if (existingStaff && existingStaff.storeId !== ownerStore.id) {
      this.logger.warn(
        `skip legacy owner membership repair for user ${payload.sub}: conflicting staff ${existingStaff.id} belongs to store ${existingStaff.storeId}`,
      );
      return false;
    }

    const normalizedOwnerName = ownerStore.owner.name?.trim();
    const nextName =
      normalizedOwnerName && normalizedOwnerName.length > 0
        ? normalizedOwnerName
        : '老板';

    if (existingStaff) {
      await this.prisma.staff.update({
        where: { id: existingStaff.id },
        data: {
          storeId: ownerStore.id,
          userId: payload.sub,
          email: ownerStore.owner.email,
          phone: payload.phone,
          name: nextName,
          role: StaffRole.owner,
          permissions: ['*'],
          status: StaffStatus.active,
          isSeatActive: true,
          isActive: true,
        },
      });
      this.logger.log(
        `repaired legacy owner staff ${existingStaff.id} for store ${ownerStore.id}`,
      );
      return true;
    }

    await this.prisma.staff.create({
      data: {
        storeId: ownerStore.id,
        userId: payload.sub,
        email: ownerStore.owner.email,
        phone: payload.phone,
        name: nextName,
        role: StaffRole.owner,
        permissions: ['*'],
        status: StaffStatus.active,
        isSeatActive: true,
        isActive: true,
      },
    });
    this.logger.log(
      `created legacy owner staff for store ${ownerStore.id} and user ${payload.sub}`,
    );
    return true;
  }
}
