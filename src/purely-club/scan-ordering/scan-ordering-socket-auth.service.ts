import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { AuthBanGuardService } from '../../purely-profit/auth/auth-ban-guard.service';
import { AuthMembershipResolverService } from '../../purely-profit/auth/auth-membership-resolver.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { AuthUserCacheService } from '../../purely-profit/auth/auth-user-cache.service';
import type { ResolvedAuthUserRecord } from '../../purely-profit/auth/auth-user-cache.service';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../../purely-profit/auth/strategies/jwt.strategy';
import type { AuthenticatedMembership } from '../../purely-profit/access-control/access-control.service';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import type { SocketIdentity } from './scan-ordering-socket.types';

/** 鉴权通过后的账号快照 + 当前门店成员上下文。 */
interface ResolvedSocketAccount {
  account: ResolvedAuthUserRecord;
  currentMembership: AuthenticatedMembership | null;
}

/**
 * 扫码点餐 Socket 身份校验。
 *
 * 与 HTTP 侧 `JwtStrategy` 同源：签名 → 用户快照（5 分钟 Redis 缓存）→ tokenVersion →
 * 会话活性 → 封禁，最后解析会员上下文。小程序弱网重连风暴下不直查 `users` 表，
 * 同时保证被踢下线 / 封禁账号无法建连（与 HTTP 侧口径一致）。
 */
@Injectable()
export class ScanOrderingSocketAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authUserCacheService: AuthUserCacheService,
    private readonly authBanGuardService: AuthBanGuardService,
    private readonly authSessionService: AuthSessionService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
  ) {}

  /** 校验握手凭证并返回 socket 身份快照。 */
  async authenticate(client: Socket): Promise<SocketIdentity> {
    const payload = this.verifyAccessToken(this.extractToken(client));
    const { account, currentMembership } = await this.resolveAccount(payload);
    return {
      userId: payload.sub,
      email: account.email,
      phone: payload.phone,
      currentMembership,
    };
  }

  /** 读取已鉴权连接的身份；未鉴权直接拒绝。 */
  identityOf(client: Socket): SocketIdentity {
    const identity = client.data.identity as SocketIdentity | undefined;
    if (!identity)
      throw new UnauthorizedException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_WS_CONNECTION_UNAUTHENTICATED,
          '连接尚未认证',
        ),
      );
    return identity;
  }

  /** 将 socket 身份快照转换为权限校验所需的 AuthenticatedUser。 */
  toAuthenticatedUser(identity: SocketIdentity): AuthenticatedUser {
    return {
      id: identity.userId,
      email: identity.email,
      phone: identity.phone,
      name: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastActiveAt: null,
      currentMembership: identity.currentMembership,
    };
  }

  /** 优先取 handshake.auth.token，其次兼容 Authorization: Bearer 头。 */
  private extractToken(client: Socket): string {
    const rawToken =
      client.handshake.auth?.token ??
      client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (typeof rawToken !== 'string' || !rawToken) {
      throw new UnauthorizedException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_WS_TOKEN_MISSING,
          '缺少访问令牌',
        ),
      );
    }
    return rawToken;
  }

  /** 校验 JWT 签名与 sub 声明。 */
  private verifyAccessToken(rawToken: string): JwtPayload {
    const payload = this.jwtService.verify<JwtPayload>(rawToken);
    if (!payload.sub)
      throw new UnauthorizedException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_WS_TOKEN_INVALID,
          '访问令牌无效',
        ),
      );
    return payload;
  }

  /** 聚合用户快照、tokenVersion、会话活性、封禁与会员上下文。 */
  private async resolveAccount(
    payload: JwtPayload,
  ): Promise<ResolvedSocketAccount> {
    const [account, currentTokenVersion, sessionActive] = await Promise.all([
      this.authUserCacheService.resolveUser(payload.sub),
      this.authSessionService.getTokenVersion(payload.sub),
      payload.sid
        ? this.authSessionService.isSessionActive(payload.sub, payload.sid)
        : Promise.resolve(true),
      this.authBanGuardService.ensureUserNotBanned(payload.sub),
    ] as const);

    if (!account)
      throw new UnauthorizedException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_WS_USER_NOT_FOUND,
          '用户不存在',
        ),
      );

    if ((payload.sessionVersion ?? 0) < currentTokenVersion) {
      throw new UnauthorizedException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_WS_SESSION_REVOKED,
          '登录态已失效，请重新登录',
        ),
      );
    }

    if (!sessionActive) {
      throw new UnauthorizedException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.AUTH_WS_SESSION_REVOKED,
          '您的账号已在其他设备登录，当前会话已失效',
        ),
      );
    }

    const currentMembership =
      await this.authMembershipResolverService.resolveAuthenticatedMembership(
        payload,
        account.email,
      );
    return { account, currentMembership };
  }
}
