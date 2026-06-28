import { SetMetadata } from '@nestjs/common';

export const CACHE_CONTROL_KEY = 'cache:control';

export interface CacheControlOptions {
  /**
   * max-age 值（秒），表示响应在多少秒内可被客户端缓存。
   * 默认 0（不缓存）。
   */
  maxAge?: number;

  /**
   * 是否使用 private 指令（仅客户端缓存，CDN/代理不可缓存）。
   * 对于需要鉴权的接口默认应设为 true。
   * 默认 true。
   */
  private?: boolean;
}

/**
 * 装饰器：为接口添加 Cache-Control 响应头配置。
 *
 * 使用示例：
 * ```ts
 * @CacheControl({ maxAge: 30 })  // Cache-Control: private, max-age=30
 * @Get()
 * list() { ... }
 * ```
 *
 * 实际响应头的添加由 CacheControlInterceptor 完成。
 */
export const CacheControl = (options: CacheControlOptions = {}) =>
  SetMetadata(CACHE_CONTROL_KEY, {
    maxAge: options.maxAge ?? 0,
    private: options.private ?? true,
  } satisfies CacheControlOptions);
