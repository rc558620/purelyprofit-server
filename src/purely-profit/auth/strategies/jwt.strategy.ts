import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthAccountMembershipService } from '../auth-account-membership.service';
import { AuthSessionService } from '../auth-session.service';
import type {
  AuthenticatedAccountScope,
  AuthPulseMode,
} from '../auth-account.types';
import { resolveAuthIdentity } from '../auth.utils';

export interface AuthenticatedUser {
  id: number;
  email: string;
  phone: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  accountScope?: AuthenticatedAccountScope;
  currentMembership:
    | import('../../access-control/access-control.service').AuthenticatedMembership
    | null;
  pulseMode?: AuthPulseMode;
  isPulseDeveloper?: boolean;
}

export interface JwtPayload {
  sub: number;
  phone: string;
  accountScope?: AuthenticatedAccountScope;
  sessionVersion?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly pulseDevAccountEmails: Set<string>;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authAccountMembershipService: AuthAccountMembershipService,
    private readonly authSessionService: AuthSessionService,
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

    const currentTokenVersion = await this.authSessionService.getTokenVersion(
      payload.sub,
    );
    if ((payload.sessionVersion ?? 0) < currentTokenVersion) {
      throw new UnauthorizedException('登录态已失效，请重新登录');
    }

    await this.authAccountMembershipService.ensureUserNotBanned(payload.sub);

    const identity = resolveAuthIdentity(
      user.email,
      payload.phone,
      this.pulseDevAccountEmails,
    );
    const currentMembership =
      await this.authAccountMembershipService.resolveAuthenticatedMembership(
        payload,
        user.email,
      );

    return {
      id: user.id,
      email: user.email,
      phone: payload.phone,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      accountScope: payload.accountScope ?? identity.accountScope,
      currentMembership,
      pulseMode: identity.pulseMode,
      isPulseDeveloper: identity.isPulseDeveloper,
    };
  }
}
