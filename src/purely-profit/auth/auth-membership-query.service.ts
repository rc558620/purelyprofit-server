import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { AuthMembershipContextRow } from './auth-account.types';
import { AUTH_MEMBERSHIP_ROWS_CACHE_TTL_SECONDS } from './auth.constants';
import { buildMembershipRowsCacheKey } from './auth.utils';
import type { JwtPayload } from './strategies/jwt.strategy';

/**
 * 会员上下文行查询：负责按 JWT payload 解析用户命中的 staff 行集合，
 * 并承担 Redis 缓存读写与 schema 缺失守卫。
 */
@Injectable()
export class AuthMembershipQueryService {
  private readonly logger = new Logger(AuthMembershipQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async findMembershipRows(
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
          sa.can_use_handover AS "subAccountCanUseHandover",
          s.business_mode AS "businessMode"
        FROM staffs st
        INNER JOIN stores s ON s.id = st.store_id
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
