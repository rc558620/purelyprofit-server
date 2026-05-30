import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StaffRole,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedMembership } from '../../access-control/access-control.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { ADMIN_LOGIN_PHONE, AUTH_TOKEN_VERSION_KEY_PREFIX } from '../auth.constants';

export type PulseMode = 'normal' | 'developer';

export interface AuthenticatedUser {
  id: number;
  email: string;
  phone: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  currentMembership: AuthenticatedMembership | null;
  pulseMode?: PulseMode;
  isPulseDeveloper?: boolean;
}

export interface JwtPayload {
  sub: number;
  phone: string;
  sessionVersion?: number;
}

type MembershipRow = {
  id: number;
  storeId: number;
  role: StaffRole;
  permissions: string[];
  isActive: boolean;
  linkedEmployeeId: number | null;
  subAccountId: number | null;
  subAccountRole: StoreSubAccountRole | null;
  subAccountStatus: StoreSubAccountStatus | null;
  subAccountAssigned: boolean | null;
  subAccountCanAccessHome: boolean | null;
  subAccountCanUseHandover: boolean | null;
};

type LegacyMembershipRow = {
  id: number;
  storeId: number;
  role: StaffRole;
  permissions: string[];
  isActive: boolean;
  linkedEmployeeId: number | null;
};

const PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX =
  'pulse:membership:admin:member:';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly pulseDevAccountEmails: Set<string>;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
    private readonly redisService: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') ?? 'secret',
    });

    this.pulseDevAccountEmails = new Set(
      (configService.get<string[]>('pulse.devAccountEmails') ?? []).map(
        (email) => email.trim().toLowerCase(),
      ),
    );
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const currentTokenVersion = await this.getTokenVersion(payload.sub);
    if ((payload.sessionVersion ?? 0) < currentTokenVersion) {
      throw new UnauthorizedException('登录态已失效，请重新登录');
    }

    await this.ensureUserNotBanned(payload.sub);

    const memberships = await this.findMemberships(payload, user.email);

    const [currentMembership] = memberships;
    const normalizedEmail = user.email.trim().toLowerCase();
    const isPulseDeveloper =
      this.pulseDevAccountEmails.has(normalizedEmail) ||
      payload.phone === ADMIN_LOGIN_PHONE;
    const pulseMode: PulseMode = isPulseDeveloper ? 'developer' : 'normal';

    return {
      id: user.id,
      email: user.email,
      phone: payload.phone,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      currentMembership: currentMembership
        ? this.accessControlService.buildMembershipContext(
            {
              id: currentMembership.id,
              storeId: currentMembership.storeId,
              role: currentMembership.role,
              permissions: currentMembership.permissions,
              isActive: currentMembership.isActive,
              linkedEmployeeId: currentMembership.linkedEmployeeId,
            },
            currentMembership.subAccountId
              ? {
                  id: currentMembership.subAccountId,
                  employeeId: currentMembership.linkedEmployeeId,
                  role:
                    currentMembership.subAccountRole ??
                    StoreSubAccountRole.cashier,
                  status:
                    currentMembership.subAccountStatus ??
                    StoreSubAccountStatus.inactive,
                  isAssigned: currentMembership.subAccountAssigned ?? false,
                  canAccessHome:
                    currentMembership.subAccountCanAccessHome ?? false,
                  canUseHandover:
                    currentMembership.subAccountCanUseHandover ?? false,
                }
              : null,
          )
        : null,
      pulseMode,
      isPulseDeveloper,
    };
  }

  private async findMemberships(
    payload: JwtPayload,
    userEmail: string,
  ): Promise<MembershipRow[]> {
    try {
      return await this.prisma.$queryRaw<MembershipRow[]>`
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
          AND st.status = 'ACTIVE'
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

      console.warn(
        '[auth] store_sub_accounts schema not ready, fallback to legacy membership query',
      );

      const legacyMemberships = await this.prisma.$queryRaw<
        LegacyMembershipRow[]
      >`
        SELECT
          st.id,
          st.store_id AS "storeId",
          st.role,
          st.permissions,
          st.is_active AS "isActive",
          emp.id AS "linkedEmployeeId"
        FROM staffs st
        LEFT JOIN employees emp ON emp.linked_staff_id = st.id
        WHERE st.is_active = true
          AND st.status = 'ACTIVE'
          AND (
            st.user_id = ${payload.sub}
            OR st.email = ${userEmail}
            OR st.phone = ${payload.phone}
          )
        ORDER BY
          CASE
            WHEN st.role = 'OWNER' THEN 1
            WHEN st.role = 'MANAGER' THEN 2
            ELSE 3
          END,
          st.id ASC
      `;

      return legacyMemberships.map((membership) => ({
        ...membership,
        subAccountId: null,
        subAccountRole: null,
        subAccountStatus: null,
        subAccountAssigned: null,
        subAccountCanAccessHome: null,
        subAccountCanUseHandover: null,
      }));
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

  private async getTokenVersion(userId: number): Promise<number> {
    const rawVersion = await this.redisService.get(
      `${AUTH_TOKEN_VERSION_KEY_PREFIX}${userId}`,
    );
    const parsedVersion = Number.parseInt(rawVersion ?? '0', 10);
    return Number.isNaN(parsedVersion) ? 0 : parsedVersion;
  }

  private async ensureUserNotBanned(userId: number): Promise<void> {
    const relatedStoreIds = await this.findUserRelatedStoreIds(userId);
    if (relatedStoreIds.length === 0) {
      return;
    }

    const banReasons = await Promise.all(
      relatedStoreIds.map((storeId) =>
        this.redisService.get(this.getPulseAdminMemberBanReasonKey(storeId)),
      ),
    );
    const hasBannedStore = banReasons.some((reason) => Boolean(reason?.trim()));

    if (hasBannedStore) {
      throw new UnauthorizedException('账号已被封禁');
    }
  }

  private async findUserRelatedStoreIds(userId: number): Promise<number[]> {
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

    return stores.map((store) => store.id);
  }

  private getPulseAdminMemberBanReasonKey(storeId: number): string {
    return `${PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX}${storeId}:ban-reason`;
  }
}
