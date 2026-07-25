import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  CACHE_CONTROL_KEY,
  type CacheControlOptions,
} from './cache-control.decorator';
import { Reflector } from '@nestjs/core';

/**
 * 全局拦截器：根据 @CacheControl() 装饰器为响应添加 Cache-Control 头。
 *
 * 对于需要鉴权的接口，默认使用 `private` 指令，
 * 防止 CDN/代理缓存包含用户特定数据的响应。
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<CacheControlOptions | undefined>(
      CACHE_CONTROL_KEY,
      context.getHandler(),
    );

    if (!options || !options.maxAge || options.maxAge <= 0) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const visibility = options.private !== false ? 'private' : 'public';
        response.header(
          'Cache-Control',
          `${visibility}, max-age=${options.maxAge}`,
        );
      }),
    );
  }
}
