import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthBanGuardService } from '../auth-ban-guard.service';
import { AuthMembershipResolverService } from '../auth-membership-resolver.service';
import { AuthSessionService } from '../auth-session.service';
import { AuthUserCacheService } from '../auth-user-cache.service';
import type {
  AuthenticatedAccountScope,
  AuthPulseMode,
  TokenAudience,
} from '../auth-account.types';
import { resolveAuthIdentity } from '../auth.utils';

export interface AuthenticatedUser {
  id: number;
  email: string;
  phone: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date | null;
  accountScope?: AuthenticatedAccountScope;
  currentMembership:
    | import('../../access-control/access-control.service').AuthenticatedMembership
    | null;
  pulseMode?: AuthPulseMode;
  isPulseDeveloper?: boolean;
  /** token 的 aud 字段，用于 Guard 层产品线 audience 校验 */
  tokenAudience?: TokenAudience;
}

export interface JwtPayload {
  sub: number;
  phone: string;
  accountScope?: AuthenticatedAccountScope;
  sessionVersion?: number;
  /** 登录时命中的 Staff ID，用于 membership 精确解析（旧 token 可能无此字段） */
  staffId?: number;
  /** 会话唯一标识，用于精细化会话管理（旧 token 可能无此字段） */
  sid?: string;
  /**
   * token audience，标识签发时的产品线上下文，用于 Guard 层二次校验。
   * 旧 token 可能无此字段，此时 Guard 跳过 audience 校验。
   */
  aud?: TokenAudience;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private static readonly logger = new Logger(JwtStrategy.name);
  private readonly pulseDevAccountEmails: Set<string>;
  private readonly adminLoginPhone: string;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authUserCacheService: AuthUserCacheService,
    private readonly authBanGuardService: AuthBanGuardService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
    private readonly authSessionService: AuthSessionService,
  ) {
    const jwtSecret = configService.get<string>('jwt.secret');
    if (!jwtSecret) {
      throw new Error(
        '[JwtStrategy] jwt.secret 未配置。请设置 JWT_SECRET 环境变量，禁止使用硬编码默认值',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });

    this.pulseDevAccountEmails = new Set(
      (configService.get<string[]>('pulse.devAccountEmails') ?? []).map(
        (email) => email.trim().toLowerCase(),
      ),
    );
    this.adminLoginPhone =
      configService.get<string>('auth.adminLoginPhone') ?? '13619654020';
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // user / tokenVersion / 会话活性 / 封禁检查四者互不依赖，并行发起：
    // 串行时鉴权链路要 ~6 次 Redis 往返（membership 查询依赖 user.email，
    // 只能等本轮结束后再发），远程 Redis 下仅鉴权就占 100ms+。
    const [user, currentTokenVersion, sessionActive] = await Promise.all([
      this.authUserCacheService.resolveUser(payload.sub),
      this.authSessionService.getTokenVersion(payload.sub),
      payload.sid
        ? this.authSessionService.isSessionActive(payload.sub, payload.sid)
        : Promise.resolve(true),
      // 封禁检查通过即 resolve；被拒时与其余检查在同一轮 reject
      this.authBanGuardService.ensureUserNotBanned(payload.sub),
    ] as const);

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if ((payload.sessionVersion ?? 0) < currentTokenVersion) {
      throw new UnauthorizedException('登录态已失效，请重新登录');
    }

    // 检查会话是否仍活跃（已被踢下线的会话拒绝访问）
    if (!sessionActive) {
      throw new UnauthorizedException(
        '您的账号已在其他设备登录，当前会话已失效',
      );
    }

    const identity = resolveAuthIdentity(
      user.email,
      payload.phone,
      this.pulseDevAccountEmails,
      this.adminLoginPhone,
    );
    const currentMembership =
      await this.authMembershipResolverService.resolveAuthenticatedMembership(
        payload,
        user.email,
      );

    // 异步更新 lastActiveAt，不阻塞鉴权流程
    // 使用 5 分钟节流避免每次请求都写库
    // 当触发更新时，返回值使用本次 now，确保下游拿到的 lastActiveAt 语义为"本次活跃时间"
    const now = new Date();
    const throttleMs = 5 * 60 * 1000;
    const shouldUpdateLastActiveAt =
      !user.lastActiveAt ||
      now.getTime() - user.lastActiveAt.getTime() > throttleMs;
    if (shouldUpdateLastActiveAt) {
      // 非关键路径：fire-and-forget 更新 lastActiveAt，不阻塞鉴权流程
      void (async () => {
        try {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { lastActiveAt: now },
          });
        } catch (error: unknown) {
          JwtStrategy.logger.warn(
            `更新 lastActiveAt 失败 (userId=${user.id}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
    }

    return {
      id: user.id,
      email: user.email,
      phone: payload.phone,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastActiveAt: shouldUpdateLastActiveAt ? now : user.lastActiveAt,
      accountScope: payload.accountScope ?? identity.accountScope,
      currentMembership,
      pulseMode: identity.pulseMode,
      isPulseDeveloper: identity.isPulseDeveloper,
      tokenAudience: payload.aud,
    };
  }
}
