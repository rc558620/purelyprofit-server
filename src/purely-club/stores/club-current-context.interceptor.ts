import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from './club-current-store-context.service';
import type { ClubCurrentContext } from './club-stores.types';

interface ClubContextRequest {
  user?: AuthenticatedUser;
  clubCurrentContext?: ClubCurrentContext;
}

@Injectable()
export class ClubCurrentContextInterceptor implements NestInterceptor {
  constructor(
    private readonly clubCurrentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<ClubContextRequest>();
    if (!request.user) {
      // 当前请求未携带有效登录态，不应该到达此拦截器
      // 抛出更明确的异常以区分「未鉴权」和「上下文解析失败」
      throw new UnauthorizedException(
        '当前请求未鉴权，无法解析 purely-club 上下文',
      );
    }

    if (!request.clubCurrentContext) {
      request.clubCurrentContext =
        await this.clubCurrentStoreContextService.resolveCurrentContext(
          request.user,
        );
    }

    return next.handle();
  }
}
