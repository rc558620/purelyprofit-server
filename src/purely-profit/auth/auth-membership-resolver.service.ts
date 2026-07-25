import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import {
  StaffRole,
  StaffStatus,
  StoreSubAccountRole,
  StoreSubAccountStatus,
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
  buildStoreProfileKey,
} from './auth.utils';
import { AUTH_MEMBERSHIP_ROWS_CACHE_TTL_SECONDS } from './auth.constants';

@Injectable()
export class AuthMembershipResolverService {
  private readonly logger = new Logger(AuthMembershipResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findCurrentMembership(
    user: AuthenticatedUser,
  ): Promise<ProfileMembershipRecord | null> {
    if (!user.currentMembership) {
      return null;
    }

    const membership = await this.prisma.$queryRaw<
      Pick<
        ProfileMembershipRecord,
        | 'storeName'
        | 'address'
        | 'businessMode'
        | 'storeCreatedAt'
        | 'storeUpdatedAt'
      >[]
    >`
      SELECT
        s.name AS "storeName",
        s.address,
        s.business_mode AS "businessMode",
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
    let rows = await this.findMembershipRows(payload, userEmail);

    if (rows.length === 0) {
      const repaired = await this.repairLegacyOwnerMembership(
        payload,
        userEmail,
      );
      if (repaired) {
        rows = await this.findMembershipRows(payload, userEmail);
      }
    }

    // 严格匹配策略：
    // 1. 若 JWT 携带 staffId（新 token），优先精确匹配 staff.id
    // 2. 否则按 userId 精确匹配（兼容旧 token）
    // 3. 两者都无匹配则拒绝 OR 宽匹配回退，防止跨租户串号
    let currentMembership: AuthMembershipContextRow | null = null;

    if (payload.staffId != null) {
      const staffMatched = rows.find((r) => r.id === payload.staffId);
      if (staffMatched) {
        currentMembership = staffMatched;
      }
    }

    if (!currentMembership) {
      const userIdMatched = rows.filter((r) => r.userId === payload.sub);
      if (userIdMatched.length === 1) {
        // 单条匹配：安全回退
        currentMembership = userIdMatched[0];
      } else if (userIdMatched.length > 1) {
        // ── Bug 2 修复：旧 token 多门店回退守卫 ──
        // 多门店多 Staff 时，旧 token（无 staffId）无法确定用户意图门店。
        // 仅在存在唯一的「无子账号」行时允许回退，否则拒绝防止跨门店串号。
        const nonSubAccountRows = userIdMatched.filter(
          (r) => r.subAccountId == null,
        );
        if (nonSubAccountRows.length === 1) {
          currentMembership = nonSubAccountRows[0];
        } else {
          this.logger.warn(
            `membership for userId=${payload.sub} rejected: ${userIdMatched.length} userId-matched rows (${nonSubAccountRows.length} non-sub-account), ambiguous store context for legacy token, denying to prevent cross-store identity mix-up`,
          );
        }
      }
    }

    if (!currentMembership && rows.length > 0) {
      this.logger.warn(
        `membership for userId=${payload.sub}${payload.staffId != null ? `, staffId=${payload.staffId}` : ''} rejected: ${rows.length} rows found via OR email/phone match but none with exact match, denying to prevent cross-tenant access`,
      );
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
    } catch (error: unknown) {
      this.logger.warn(
        `读取门店 ${storeId} 档案缓存失败，回退到默认值: ${error instanceof Error ? error.message : String(error)}`,
      );
      return normalizeStoreProfileMetadata(null);
    }
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
    } catch (error: unknown) {
      // 缓存读取失败，回退到数据库查询
      this.logger.warn(
        `读取会员行缓存失败，回退到数据库查询: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const rows = await this.queryMembershipRowsFromDb(payload, userEmail);

    // 异步回填缓存，TTL 2 分钟
    this.redisService
      .setJson(cacheKey, rows, AUTH_MEMBERSHIP_ROWS_CACHE_TTL_SECONDS)
      .catch((error: unknown) => {
        // 缓存写入失败不影响鉴权
        this.logger.warn(
          `回填会员行缓存失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    return rows;
  }

  private async queryMembershipRowsFromDb(
    payload: JwtPayload,
    _userEmail: string,
  ): Promise<AuthMembershipContextRow[]> {
    try {
      return await this.prisma.$queryRaw<AuthMembershipContextRow[]>`
        SELECT
          st.id,
          st.store_id AS "storeId",
          st.user_id AS "userId",
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
        LEFT JOIN store_sub_accounts sa
          ON sa.employee_id = emp.id
          AND sa.status = 'active'
          AND sa.is_assigned = true
          AND sa.can_access_home = true
        WHERE st.is_active = true
          AND st.status = ${StaffStatus.active}
          AND st.user_id = ${payload.sub}
        ORDER BY
          CASE WHEN st.user_id = ${payload.sub} THEN 0 ELSE 1 END,
          CASE
            WHEN sa.id IS NOT NULL THEN 0
            WHEN st.role = 'owner' THEN 1
            WHEN st.role = 'manager' THEN 2
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
}
