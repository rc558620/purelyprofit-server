import { Injectable, UnauthorizedException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from '../../shared/audit-log.service';
import type { AuthProductScope } from './auth-account.types';
import {
  AUTH_LOGIN_FAIL_MAX_ATTEMPTS,
  AUTH_LOGIN_FAIL_LOCK_TTL_SECONDS,
  AUTH_LOGIN_FAIL_KEY_PREFIX,
} from './auth.constants';

/**
 * 登录失败锁定守卫服务。
 *
 * 职责：
 * - 基于 Redis INCR 原子递增记录登录失败次数
 * - 达到阈值后临时锁定账号（TTL 控制）
 * - 登录成功后清除失败计数
 */
@Injectable()
export class AuthLoginFailGuardService {
  constructor(
    private readonly redisService: RedisService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * 检查账号是否因多次登录失败被临时锁定
   */
  async ensureLoginNotLocked(
    loginAccount: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    const key = this.buildLoginFailKey(loginAccount, productScope);
    const rawCount = await this.redisService.get(key);
    const failCount = Number.parseInt(rawCount ?? '0', 10);

    if (failCount >= AUTH_LOGIN_FAIL_MAX_ATTEMPTS) {
      // 统一为通用错误消息，避免通过差异化提示枚举账号存在性
      throw new UnauthorizedException('账号或密码错误');
    }
  }

  /**
   * 记录一次登录失败，使用 Redis INCR 原子递增。
   * @returns 递增后的失败计数
   */
  async recordLoginFailure(
    loginAccount: string,
    productScope: AuthProductScope,
  ): Promise<number> {
    const key = this.buildLoginFailKey(loginAccount, productScope);
    const newCount = await this.redisService.incr(
      key,
      AUTH_LOGIN_FAIL_LOCK_TTL_SECONDS,
    );

    // 如果刚好达到阈值，设置锁定时长（重新设置 TTL 为锁定时长）
    if (newCount >= AUTH_LOGIN_FAIL_MAX_ATTEMPTS) {
      await this.redisService.set(
        key,
        String(newCount),
        AUTH_LOGIN_FAIL_LOCK_TTL_SECONDS,
      );
      // 账号锁定审计日志
      this.auditLogService.record({
        action: 'login.fail.lock',
        resourceType: 'user',
        resourceId: loginAccount.toLowerCase(),
        metadata: {
          productScope,
          failCount: newCount,
        },
      });
    }

    return newCount;
  }

  /**
   * 登录成功后清除失败计数
   */
  async clearLoginFailures(
    loginAccount: string,
    productScope: AuthProductScope,
  ): Promise<void> {
    const key = this.buildLoginFailKey(loginAccount, productScope);
    await this.redisService.del(key);
  }

  private buildLoginFailKey(
    loginAccount: string,
    productScope: AuthProductScope,
  ): string {
    return `${AUTH_LOGIN_FAIL_KEY_PREFIX}${productScope}:${loginAccount.toLowerCase()}`;
  }
}
