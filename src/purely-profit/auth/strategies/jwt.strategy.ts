import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedMembership } from '../../access-control/access-control.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AUTH_TOKEN_VERSION_KEY_PREFIX } from '../auth.constants';

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

type MembershipRole = 'OWNER' | 'MANAGER' | 'STAFF';

export interface JwtPayload {
  sub: number;
  phone: string;
  sessionVersion?: number;
}

const PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX = 'pulse:membership:admin:member:';

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
      (configService.get<string[]>('pulse.devAccountEmails') ?? []).map((email) =>
        email.trim().toLowerCase(),
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

    const memberships = await this.prisma.$queryRaw<
      Array<{
        id: number;
        storeId: number;
        role: MembershipRole;
        permissions: string[];
        isActive: boolean;
      }>
    >`
      SELECT
        id,
        store_id AS "storeId",
        role,
        permissions,
        is_active AS "isActive"
      FROM staffs
      WHERE is_active = true
        AND status = 'ACTIVE'
        AND (
          user_id = ${payload.sub}
          OR email = ${user.email}
          OR phone = ${payload.phone}
        )
      ORDER BY
        CASE role
          WHEN 'OWNER' THEN 0
          WHEN 'MANAGER' THEN 1
          ELSE 2
        END,
        id ASC
    `;

    const [currentMembership] = memberships;
    const normalizedEmail = user.email.trim().toLowerCase();
    const pulseMode: PulseMode = this.pulseDevAccountEmails.has(normalizedEmail)
      ? 'developer'
      : 'normal';

    return {
      id: user.id,
      email: user.email,
      phone: payload.phone,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      currentMembership: currentMembership
        ? this.accessControlService.buildMembershipContext(currentMembership)
        : null,
      pulseMode,
      isPulseDeveloper: pulseMode === 'developer',
    };
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
