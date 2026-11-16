import { Injectable, Logger } from '@nestjs/common';
import { StaffRole, StaffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AUTH_LEGACY_OWNER_ABSENT_TTL_SECONDS } from './auth.constants';
import { buildLegacyOwnerAbsentCacheKey } from './auth.utils';
import type { JwtPayload } from './strategies/jwt.strategy';

/**
 * 遗留店主会员补齐：老店主账号仅存在 stores.ownerId 时，
 * 自动补齐对应的 owner staff 记录，避免历史数据导致无法登录。
 *
 * 「该账号没有 owner 门店」这一结果带 5 分钟负缓存：C 端会员账号永远不会有
 * stores.owner_id，而 membership rows 为空时每次鉴权都会调用本服务，
 * 无负缓存时等于每个 C 端请求都白跑一次落空查询。
 */
@Injectable()
export class AuthLegacyOwnerRepairService {
  private readonly logger = new Logger(AuthLegacyOwnerRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async repairLegacyOwnerMembership(
    payload: JwtPayload,
    userEmail: string,
  ): Promise<boolean> {
    if (await this.isOwnerAbsentCached(payload.sub)) {
      return false;
    }

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
      await this.markOwnerAbsent(payload.sub);
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

  /**
   * 账号获得门店 ownership 后清掉负缓存。
   *
   * 目前只有账号合并（微信账号 → 手机号账号）会迁移 stores.owner_id，
   * 迁移后目标账号在负缓存 TTL 内不会触发补齐，商家端会看不到门店。
   */
  async invalidateOwnerAbsentCache(userId: number): Promise<void> {
    try {
      await this.redisService.del(buildLegacyOwnerAbsentCacheKey(userId));
    } catch (error: unknown) {
      this.logger.warn(
        `清除遗留店主负缓存失败 (userId=${userId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 读负缓存；缓存不可用时按未命中处理（宁可多查一次库，也不能误判） */
  private async isOwnerAbsentCached(userId: number): Promise<boolean> {
    try {
      return await this.redisService.exists(
        buildLegacyOwnerAbsentCacheKey(userId),
      );
    } catch (error: unknown) {
      this.logger.warn(
        `读取遗留店主负缓存失败 (userId=${userId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** 回填负缓存；写失败不影响鉴权（下一请求多查一次库即可） */
  private async markOwnerAbsent(userId: number): Promise<void> {
    try {
      await this.redisService.set(
        buildLegacyOwnerAbsentCacheKey(userId),
        '1',
        AUTH_LEGACY_OWNER_ABSENT_TTL_SECONDS,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `回填遗留店主负缓存失败 (userId=${userId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
