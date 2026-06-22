import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import {
  StaffRole,
  StaffStatus,
  StoreSubAccountRole,
  StoreSubAccountStatus,
  type Prisma,
} from '@prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import type { AuthenticatedMembership } from '../access-control/access-control.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  normalizeStoreProfileMetadata,
  type StoreProfileMetadata,
} from '../stores/dto/store-response.dto';
import type { AuthMembershipContextRow } from './auth-account.types';
import type { ProfileMembershipRecord } from './auth-profile.types';
import type { AuthenticatedUser, JwtPayload } from './strategies/jwt.strategy';
import {
  buildMembershipRowsCacheKey,
  buildPulseAdminMemberBanReasonKey,
  buildStoreProfileKey,
  buildUserRelatedStoreIdsCacheKey,
} from './auth.utils';
import {
  AUTH_MEMBERSHIP_ROWS_CACHE_KEY_PREFIX,
  AUTH_MEMBERSHIP_ROWS_CACHE_TTL_SECONDS,
  AUTH_USER_RELATED_STORE_IDS_CACHE_TTL_SECONDS,
} from './auth.constants';

@Injectable()
export class AuthAccountMembershipService {
  private readonly logger = new Logger(AuthAccountMembershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly accessControlService: AccessControlService,
  ) {}

  /**
   * 检查用户是否被全面封禁。
   *
   * 封禁是按门店维度的：只有当用户关联的所有门店都被封禁时，才拒绝登录。
   * 若用户还有至少一个未被封禁的门店，则允许登录。
   */
  async ensureUserNotBanned(userId: number): Promise<void> {
    const relatedStoreIds = await this.findUserRelatedStoreIds(userId);
    if (relatedStoreIds.length === 0) {
      return;
    }

    // 批量 MGET 检查封禁状态，替代逐个 GET
    const banReasonKeys = relatedStoreIds.map((storeId) =>
      buildPulseAdminMemberBanReasonKey(storeId),
    );
    const banReasons = await this.redisService.mgetJson<string | null>(
      banReasonKeys,
    );
    const allStoresBanned = banReasons.every((reason) =>
      Boolean(reason?.trim()),
    );

    if (allStoresBanned) {
      throw new UnauthorizedException('账号已被封禁');
    }
  }

  async findCurrentMembership(
    user: AuthenticatedUser,
  ): Promise<ProfileMembershipRecord | null> {
    if (!user.currentMembership) {
      return null;
    }

    const membership = await this.prisma.$queryRaw<
      Pick<
        ProfileMembershipRecord,
        'storeName' | 'address' | 'storeCreatedAt' | 'storeUpdatedAt'
      >[]
    >`
      SELECT
        s.name AS "storeName",
        s.address,
        s.created_at AS "storeCreatedAt",
        s.updated_at AS "storeUpdatedAt"
      FROM staffs st
      INNER JOIN stores s ON s.id = st.store_id
      WHERE st.id = ${user.currentMembership.staffId}
        AND st.store_id = ${user.currentMembership.storeId}
      LIMIT 1
    `;

    const currentStore = membership[0];
    if (!currentStore) {
      return null;
    }

    return {
      staffId: user.currentMembership.staffId,
      storeId: user.currentMembership.storeId,
      role: user.currentMembership.role,
      permissions: user.currentMembership.permissions,
      isActive: user.currentMembership.isActive,
      identityType: user.currentMembership.subjectType,
      subAccountRole: user.currentMembership.subAccountRole,
      ...currentStore,
    };
  }

  async resolveAuthenticatedMembership(
    payload: JwtPayload,
    userEmail: string,
  ): Promise<AuthenticatedMembership | null> {
    let [currentMembership] = await this.findMembershipRows(payload, userEmail);

    if (!currentMembership) {
      const repaired = await this.repairLegacyOwnerMembership(
        payload,
        userEmail,
      );
      if (repaired) {
        [currentMembership] = await this.findMembershipRows(payload, userEmail);
      }
    }

    return this.buildAuthenticatedMembership(currentMembership);
  }

  async readStoreProfileMetadata(
    storeId: number,
  ): Promise<StoreProfileMetadata> {
    try {
      const raw = await this.redisService.get(buildStoreProfileKey(storeId));
      if (!raw) {
        return normalizeStoreProfileMetadata(null);
      }

      return normalizeStoreProfileMetadata(JSON.parse(raw));
    } catch {
      return normalizeStoreProfileMetadata(null);
    }
  }

  async activateInvitedStaffMemberships(
    userId: number,
    identifiers: { phone: string; email: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const invitedStaffs = await tx.staff.findMany({
        where: {
          OR: [
            { userId },
            { email: identifiers.email },
            { phone: identifiers.phone },
          ],
          status: StaffStatus.INVITED,
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
          status: StaffStatus.ACTIVE,
          isSeatActive: true,
          isActive: true,
        },
      });
    });
    await this.invalidateMembershipRowsCacheByUserId(userId);
  }

  private async findMembershipRows(
    payload: JwtPayload,
    userEmail: string,
  ): Promise<AuthMembershipContextRow[]> {
    const cacheKey = buildMembershipRowsCacheKey(
      payload.sub,
      userEmail,
      payload.phone,
    );

    try {
      const cached =
        await this.redisService.getJson<AuthMembershipContextRow[]>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // 缓存读取失败，回退到数据库查询
    }

    const rows = await this.queryMembershipRowsFromDb(payload, userEmail);

    // 异步回填缓存，TTL 2 分钟
    this.redisService
      .setJson(cacheKey, rows, AUTH_MEMBERSHIP_ROWS_CACHE_TTL_SECONDS)
      .catch(() => {
        // 缓存写入失败不影响鉴权
      });

    return rows;
  }

  private async queryMembershipRowsFromDb(
    payload: JwtPayload,
    userEmail: string,
  ): Promise<AuthMembershipContextRow[]> {
    try {
      return await this.prisma.$queryRaw<AuthMembershipContextRow[]>`
        SELECT
          st.id,
          st.store_id AS "storeId",
          st.role,
          st.permissions,
          st.is_active AS "isActive",
          emp.id AS "linkedEmployeeId",
          sa.id AS "subAccountId",
          sa.role AS "subAccountRole",
          sa.status AS "subAccountStatus",
          sa.is_assigned AS "subAccountAssigned",
          sa.can_access_home AS "subAccountCanAccessHome",
          sa.can_use_handover AS "subAccountCanUseHandover"
        FROM staffs st
        LEFT JOIN employees emp ON emp.linked_staff_id = st.id
        LEFT JOIN store_sub_accounts sa ON sa.employee_id = emp.id
        WHERE st.is_active = true
          AND st.status = ${StaffStatus.ACTIVE}
          AND (
            st.user_id = ${payload.sub}
            OR st.email = ${userEmail}
            OR st.phone = ${payload.phone}
          )
        ORDER BY
          CASE
            WHEN sa.id IS NOT NULL THEN 0
            WHEN st.role = 'OWNER' THEN 1
            WHEN st.role = 'MANAGER' THEN 2
            ELSE 3
          END,
          st.id ASC
      `;
    } catch (error: unknown) {
      if (!this.isMissingSubAccountSchemaError(error)) {
        throw error;
      }

      this.logger.warn(
        'store_sub_accounts schema not ready, deny login to avoid stale permission fallback',
      );
      throw new UnauthorizedException(
        '登录态能力上下文未就绪，请联系管理员完成系统升级后重试',
      );
    }
  }

  private buildAuthenticatedMembership(
    membershipRow: AuthMembershipContextRow | null | undefined,
  ): AuthenticatedMembership | null {
    if (!membershipRow) {
      return null;
    }

    return this.accessControlService.buildMembershipContext(
      {
        id: membershipRow.id,
        storeId: membershipRow.storeId,
        role: membershipRow.role,
        permissions: membershipRow.permissions,
        isActive: membershipRow.isActive,
        linkedEmployeeId: membershipRow.linkedEmployeeId,
      },
      membershipRow.subAccountId
        ? {
            id: membershipRow.subAccountId,
            employeeId: membershipRow.linkedEmployeeId,
            role: membershipRow.subAccountRole ?? StoreSubAccountRole.cashier,
            status:
              membershipRow.subAccountStatus ?? StoreSubAccountStatus.inactive,
            isAssigned: membershipRow.subAccountAssigned ?? false,
            canAccessHome: membershipRow.subAccountCanAccessHome ?? false,
            canUseHandover: membershipRow.subAccountCanUseHandover ?? false,
          }
        : null,
    );
  }

  private async repairLegacyOwnerMembership(
    payload: JwtPayload,
    userEmail: string,
  ): Promise<boolean> {
    const ownerStore = await this.prisma.store.findFirst({
      where: { ownerId: payload.sub },
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
          role: StaffRole.OWNER,
          permissions: ['*'],
          status: StaffStatus.ACTIVE,
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
        role: StaffRole.OWNER,
        permissions: ['*'],
        status: StaffStatus.ACTIVE,
        isSeatActive: true,
        isActive: true,
      },
    });
    this.logger.log(
      `created legacy owner staff for store ${ownerStore.id} and user ${payload.sub}`,
    );
    return true;
  }

  private isMissingSubAccountSchemaError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    if (
      !message.includes('store_sub_accounts') &&
      !message.includes('can_access_home') &&
      !message.includes('can_use_handover')
    ) {
      return false;
    }

    return (
      message.includes('does not exist') ||
      message.includes("doesn't exist") ||
      message.includes('unknown column') ||
      message.includes('no such table') ||
      message.includes('no such column')
    );
  }

  private async findUserRelatedStoreIds(userId: number): Promise<number[]> {
    const cacheKey = buildUserRelatedStoreIdsCacheKey(userId);

    try {
      const cached = await this.redisService.getJson<number[]>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // 缓存读取失败，回退到数据库查询
    }

    const stores = await this.prisma.store.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            staffs: {
              some: {
                userId,
                isActive: true,
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    const storeIds = stores.map((store) => store.id);

    // 异步回填缓存
    this.redisService
      .setJson(
        cacheKey,
        storeIds,
        AUTH_USER_RELATED_STORE_IDS_CACHE_TTL_SECONDS,
      )
      .catch(() => {
        // 缓存写入失败不影响鉴权
      });

    return storeIds;
  }

  private async resolveActivatableStaffIds(
    tx: Prisma.TransactionClient,
    invitedStaffs: Array<{ id: number; storeId: number }>,
  ): Promise<number[]> {
    const [firstInvitedStaff] = invitedStaffs;
    if (!firstInvitedStaff) {
      return [];
    }

    const store = await tx.store.findUnique({
      where: { id: firstInvitedStaff.storeId },
      select: {
        id: true,
        maxAccountSeats: true,
      },
    });

    if (!store) {
      return [];
    }

    const activeSeatCount = await tx.staff.count({
      where: {
        storeId: store.id,
        status: StaffStatus.ACTIVE,
        isSeatActive: true,
        isActive: true,
      },
    });

    if (activeSeatCount >= store.maxAccountSeats) {
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
    } catch {
      // 缓存失效失败不影响主流程，TTL 自然过期即可兜底
    }
  }
}
