import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedAccountScope } from '../auth-account.types';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

function ensureAllowedScope(
  user: AuthenticatedUser,
  allowedScopes: AuthenticatedAccountScope[],
  message: string,
): AuthenticatedUser {
  const accountScope = user.accountScope ?? 'purely_profit';
  if (allowedScopes.includes(accountScope)) {
    return {
      ...user,
      accountScope,
    };
  }

  throw new ForbiddenException(message);
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    err: Error | null,
    user: AuthenticatedUser | null,
  ): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('未登录或登录态已失效');
    }

    return ensureAllowedScope(
      user,
      ['purely_profit', 'developer'],
      '当前账号不可访问 purely-profit / purely-pulse 接口',
    ) as TUser;
  }
}

@Injectable()
export class ClubJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    err: Error | null,
    user: AuthenticatedUser | null,
  ): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('未登录或登录态已失效');
    }

    return ensureAllowedScope(
      user,
      ['purely_club', 'developer'],
      '当前账号不可访问 purely-club 接口',
    ) as TUser;
  }
}

@Injectable()
export class PulseJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    err: Error | null,
    user: AuthenticatedUser | null,
  ): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('未登录或登录态已失效');
    }

    return ensureAllowedScope(
      user,
      ['developer'],
      '当前账号不可访问 purely-pulse 接口',
    ) as TUser;
  }
}
