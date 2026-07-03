import { Injectable, Logger } from '@nestjs/common';
import { StaffStatus, type Prisma } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { buildUserRelatedStoreIdsCacheKey } from './auth.utils';
import { AUTH_MEMBERSHIP_ROWS_CACHE_KEY_PREFIX } from './auth.constants';

@Injectable()
export class AuthStaffActivationService {
  private readonly logger = new Logger(AuthStaffActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async activateInvitedStaffMemberships(
    userId: number,
    identifiers: { phone: string; email: string },
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const invitedStaffs = await tx.staff.findMany({
          where: {
            OR: [
              { userId },
              { email: identifiers.email },
              { phone: identifiers.phone },
            ],
            status: StaffStatus.invited,
            isActive: true,
          },
          select: {
            id: true,
            storeId: true,
          },
          orderBy: [{ storeId: 'asc' }, { id: 'asc' }],
        });

        if (invitedStaffs.length === 0) {
          return;
        }

        const activatableStaffIds = await this.resolveActivatableStaffIds(
          tx,
          invitedStaffs,
        );

        if (activatableStaffIds.length === 0) {
          return;
        }

        await tx.staff.updateMany({
          where: {
            id: {
              in: activatableStaffIds,
            },
          },
          data: {
            userId,
            status: StaffStatus.active,
            isSeatActive: true,
            isActive: true,
          },
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
    await this.invalidateMembershipCachesByUserId(userId);
  }

  /**
   * 按 userId 失效 membership rows 缓存与用户关联门店缓存。
   *
   * 调用场景：
   * - 被邀请员工激活后（activateInvitedStaffMemberships）
   * - 注册闭环创建门店后（AuthRegisterStoreService.create）
   *
   * 由于 membership rows 缓存 key 包含 email 和 phone，需使用 pattern 匹配删除。
   */
  async invalidateMembershipCachesByUserId(userId: number): Promise<void> {
    await Promise.all([
      this.invalidateMembershipRowsCacheByUserId(userId),
      this.invalidateUserRelatedStoreIdsCacheByUserId(userId),
    ]);
  }

  private async resolveActivatableStaffIds(
    tx: Prisma.TransactionClient,
    invitedStaffs: Array<{ id: number; storeId: number }>,
  ): Promise<number[]> {
    const [firstInvitedStaff] = invitedStaffs;
    if (!firstInvitedStaff) {
      return [];
    }

    const storeId = firstInvitedStaff.storeId;

    // 读取门店是否存在
    const store = await tx.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });

    if (!store) {
      return [];
    }

    // 席位上限事实源：StoreMembershipProfile.subAccountQuota（spec 0.6）
    const profile = await tx.storeMembershipProfile.findUnique({
      where: { storeId },
      select: { subAccountQuota: true },
    });
    const maxAccountSeats = profile?.subAccountQuota ?? 1;

    const activeSeatCount = await tx.staff.count({
      where: {
        storeId,
        status: StaffStatus.active,
        isSeatActive: true,
        isActive: true,
      },
    });

    if (activeSeatCount >= maxAccountSeats) {
      return [];
    }

    return [firstInvitedStaff.id];
  }

  /**
   * 按 userId 失效 membership rows 缓存。
   * 由于缓存 key 包含 email 和 phone，需使用 pattern 匹配删除。
   */
  private async invalidateMembershipRowsCacheByUserId(
    userId: number,
  ): Promise<void> {
    try {
      await this.redisService.delByPattern(
        `${AUTH_MEMBERSHIP_ROWS_CACHE_KEY_PREFIX}${userId}:*`,
      );
    } catch (error: unknown) {
      // 缓存失效失败不影响主流程，TTL 自然过期即可兜底
      this.logger.warn(
        `失效用户 ${userId} 会员行缓存失败，TTL 自然过期兜底: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async invalidateUserRelatedStoreIdsCacheByUserId(
    userId: number,
  ): Promise<void> {
    try {
      const cacheKey = buildUserRelatedStoreIdsCacheKey(userId);
      await this.redisService.del(cacheKey);
    } catch (error: unknown) {
      this.logger.warn(
        `失效用户 ${userId} 关联门店缓存失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
