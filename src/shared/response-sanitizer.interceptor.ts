import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * 需要脱敏的敏感字段列表
 *
 * 响应中如果包含这些字段，将自动从输出中移除。
 * 即使 Prisma select 意外包含了 password，也不会泄漏到客户端。
 */
const SENSITIVE_FIELDS = new Set([
  'password',
  'hashedPassword',
  'secret',
  'secretKey',
  'privateKey',
  'apiKey',
  'token', // 仅对嵌套对象中的 token 字段脱敏，顶层 access_token/refresh_token 由业务控制
]);

/**
 * 全局响应数据脱敏拦截器
 *
 * - 自动移除响应中的敏感字段（password、secret 等）
 * - 递归处理嵌套对象和数组
 * - 不影响顶层 token 字段（access_token、refresh_token）
 *
 * 与 ClassSerializerInterceptor 的区别：
 * - 本拦截器基于黑名单机制，不依赖 @Exclude() 装饰器
 * - 适用于 Prisma 返回的 plain object（非 class instance）
 * - 性能开销较低（仅在匹配到敏感字段时才做删除）
 */
@Injectable()
export class ResponseSanitizerInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((data) => this.sanitize(data)));
  }

  private sanitize(data: unknown): unknown {
    if (data === null || data === undefined) return data;
    // 流式响应（文件下载等）保持原样：实例一旦被重建为普通对象，
    // 框架将无法识别为流而退化为 JSON 序列化（下载接口会返回元数据 JSON）。
    if (data instanceof StreamableFile) return data;
    if (Array.isArray(data)) return data.map((item) => this.sanitize(item));
    if (typeof data !== 'object') return data;

    const obj = data as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // 保留顶层 token 字段（access_token、refresh_token、expires_in）
      if (
        key === 'access_token' ||
        key === 'refresh_token' ||
        key === 'expires_in'
      ) {
        cleaned[key] = value;
        continue;
      }

      // 移除敏感字段
      if (SENSITIVE_FIELDS.has(key)) {
        continue;
      }

      // 递归处理嵌套对象
      if (typeof value === 'object' && value !== null) {
        cleaned[key] = this.sanitize(value);
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned;
  }
}
