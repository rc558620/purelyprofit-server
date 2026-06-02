import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  BLOCK_SUB_ACCOUNT_KEY,
  BLOCK_SUB_ACCOUNT_MESSAGE_KEY,
} from '../decorators/block-sub-account.decorator';

@Injectable()
export class SubAccountBlockGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const shouldBlockSubAccount = this.reflector.getAllAndOverride<boolean>(
      BLOCK_SUB_ACCOUNT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!shouldBlockSubAccount) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: {
        currentMembership?: {
          subjectType?: string;
        };
      };
    }>();

    const subjectType = request.user?.currentMembership?.subjectType;
    const message = this.reflector.getAllAndOverride<string>(
      BLOCK_SUB_ACCOUNT_MESSAGE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (subjectType === 'sub_account') {
      throw new ForbiddenException(message ?? '子账号无权访问门店设置');
    }

    return true;
  }
}
