import { Injectable, Logger } from '@nestjs/common';
import { StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';
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
import { buildStoreProfileKey } from './auth.utils';
import { AuthLegacyOwnerRepairService } from './auth-legacy-owner-repair.service';
import { AuthMembershipQueryService } from './auth-membership-query.service';

/**
 * 会员上下文编排：组合会员行查询、遗留店主补齐与能力上下文构建，
 * 对外提供当前会员解析、门店档案读取能力。
 */
@Injectable()
export class AuthMembershipResolverService {
  private readonly logger = new Logger(AuthMembershipResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly accessControlService: AccessControlService,
    private readonly membershipQueryService: AuthMembershipQueryService,
    private readonly legacyOwnerRepairService: AuthLegacyOwnerRepairService,
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
    let rows = await this.membershipQueryService.findMembershipRows(
      payload,
      userEmail,
    );

    if (rows.length === 0) {
      const repaired =
        await this.legacyOwnerRepairService.repairLegacyOwnerMembership(
          payload,
          userEmail,
        );
      if (repaired) {
        rows = await this.membershipQueryService.findMembershipRows(
          payload,
          userEmail,
        );
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
    // 1. DB 优先（持久化事实源）
    try {
      const record = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { profileMetadata: true },
      });
      const raw = record?.profileMetadata;
      if (raw !== null && raw !== undefined) {
        return normalizeStoreProfileMetadata(raw);
      }
    } catch (error: unknown) {
      this.logger.warn(
        `读取门店 ${storeId} 扩展字段 DB 失败，回退 Redis: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 2. Redis 兜底（兼容历史 Redis 数据）
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
      // 传递门店业态，子账号角色（如店长）按业态解析对应权限集
      membershipRow.businessMode ?? undefined,
    );
  }
}
