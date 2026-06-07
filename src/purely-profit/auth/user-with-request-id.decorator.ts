import {
  InternalServerErrorException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

export interface UserWithRequestIdValue {
  user: AuthenticatedUser;
  requestId: string;
}

export const UserWithRequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserWithRequestIdValue => {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      id?: string | number;
    }>();

    if (!request.user) {
      throw new InternalServerErrorException('当前请求缺少登录用户信息');
    }

    if (request.id === undefined || request.id === null) {
      throw new InternalServerErrorException('当前请求缺少 request id');
    }

    return {
      user: request.user,
      requestId: String(request.id),
    };
  },
);
