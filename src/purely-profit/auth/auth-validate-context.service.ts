import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { AuthBanGuardService } from './auth-ban-guard.service';
import { AuthSessionService } from './auth-session.service';
import { AuthUserCacheService } from './auth-user-cache.service';
import type { ResolvedAuthUserRecord } from './auth-user-cache.service';
import type { JwtPayload } from './strategies/jwt.strategy';
import {
  buildTokenVersionKey,
  buildUserCacheKey,
  buildUserRelatedStoreIdsCacheKey,
} from './auth.utils';

/** JwtStrategy.validate 判定所需的鉴权上下文（membership 依赖 user.email，天然是第二跳，不在此合并） */
export interface AuthValidateContext {
  user: ResolvedAuthUserRecord | null;
  currentTokenVersion: number;
  sessionActive: boolean;
}

/** 批量读取回填的原始值；null 表示该 key 未命中（或该请求不需要该命令，例如无 sid） */
interface AuthBatchRawValues {
  userRaw: string | null;
  tokenVersionRaw: string | null;
  sessionScoreRaw: string | number | null;
  relatedStoreIdsRaw: string | null;
}

/**
 * JWT 鉴权上下文批量读取。
 *
 * 合并前 `JwtStrategy.validate` 里 4 个互不依赖的分支各自打 Redis
 * （user 缓存 GET / token 版本 GET / 会话 ZSCORE / 关联门店 GET），
 * 再叠加封禁原因的第二跳 MGET，单请求共 5 次网络交互；小程序首页并发 2 个请求即 10 次。
 *
 * 合并后固定 2 次往返：
 *  1. 一次 pipeline 取回 user 缓存、token 版本、会话 ZSCORE、关联门店 ID；
 *  2. 一次 MGET 取回各门店封禁原因（依赖第 1 步的门店 ID，无法再往前合并）。
 *
 * 第 1 步用「MGET + ZSCORE 同 pipeline」而不是单条 MGET 的原因：
 * 会话活性是 sorted set 的 ZSCORE，塞不进 MGET，只能作为同一 pipeline 的第二条命令。
 *
 * 安全性：批量读取失败时**整条链路降级为逐条读取**（合并前的原始实现），
 * 绝不把「读不到」当成「缓存未命中」或「未封禁」——判定条件与异常文案保持零变化。
 */
@Injectable()
export class AuthValidateContextService {
  constructor(
    private readonly redisService: RedisService,
    private readonly authUserCacheService: AuthUserCacheService,
    private readonly authSessionService: AuthSessionService,
    private readonly authBanGuardService: AuthBanGuardService,
  ) {}

  async load(payload: JwtPayload): Promise<AuthValidateContext> {
    const batch = await this.readBatched(payload);

    if (!batch) {
      // 降级路径：pipeline 未完成或任一命令报错，退回逐条读取（与合并前完全一致）
      return this.loadByIndividualReads(payload);
    }

    // 封禁判定与 user 解析并发：user 缓存命中时省掉一次串行等待，
    // 未命中时 DB 回源与封禁 MGET 重叠，不额外增加一拍延迟。
    const [user] = await Promise.all([
      this.resolveUserFromRaw(batch.userRaw, payload.sub),
      // 封禁判定必须先于「用户不存在 / 版本失效 / 会话失效」返回。
      // 合并前封禁拒绝藏在 Promise.all 的第 4 个分支里，任何一条先失败都会让整轮
      // reject，因此这里保持「封禁错误优先」的失败优先级，异常文案不变。
      this.authBanGuardService.ensureUserNotBannedWithRelatedStoreIdsCache(
        payload.sub,
        batch.relatedStoreIdsRaw,
      ),
    ]);

    return {
      user,
      currentTokenVersion: AuthSessionService.parseTokenVersion(
        batch.tokenVersionRaw,
      ),
      // 无 sid 的旧 token 不发起 ZSCORE，也不再判会话（与合并前一致）
      sessionActive: payload.sid ? batch.sessionScoreRaw !== null : true,
    };
  }

  /**
   * 第 1 次往返：把 3 个字符串缓存合并成一条 MGET，
   * 会话活性单独一条 ZSCORE（sorted set 命令塞不进 MGET），同一 pipeline 发出。
   */
  private async readBatched(
    payload: JwtPayload,
  ): Promise<AuthBatchRawValues | null> {
    const hasSid = Boolean(payload.sid);
    const outcome = await this.redisService.executeReadPipeline((pipeline) => {
      pipeline.mget(
        buildUserCacheKey(payload.sub),
        buildTokenVersionKey(payload.sub),
        buildUserRelatedStoreIdsCacheKey(payload.sub),
      );
      if (payload.sid) {
        pipeline.zscore(
          AuthSessionService.buildSessionSetKey(payload.sub),
          payload.sid,
        );
      }
    });

    // 回复形状与预期不符说明 pipeline 结果不可信，同样走降级
    if (!outcome.ok || outcome.replies.length !== (hasSid ? 2 : 1)) {
      return null;
    }

    const cachedValues = outcome.replies[0];
    if (!Array.isArray(cachedValues) || cachedValues.length !== 3) {
      return null;
    }

    const [userRaw, tokenVersionRaw, relatedStoreIdsRaw] = cachedValues;
    const sessionScore = hasSid ? outcome.replies[1] : null;
    return {
      userRaw,
      tokenVersionRaw,
      relatedStoreIdsRaw,
      sessionScoreRaw:
        typeof sessionScore === 'string' || typeof sessionScore === 'number'
          ? sessionScore
          : null,
    };
  }

  /**
   * 降级路径：逐条读取（合并前的原始实现，服务方法保持原样）。
   *
   * 只有 pipeline 整体失败才走到这里；此时 4 条读各自独立发起，
   * 任一读失败仍按原逻辑让整轮 reject，判定条件不做任何放宽。
   */
  private async loadByIndividualReads(
    payload: JwtPayload,
  ): Promise<AuthValidateContext> {
    const [user, currentTokenVersion, sessionActive] = await Promise.all([
      this.authUserCacheService.resolveUser(payload.sub),
      this.authSessionService.getTokenVersion(payload.sub),
      payload.sid
        ? this.authSessionService.isSessionActive(payload.sub, payload.sid)
        : Promise.resolve(true),
      this.authBanGuardService.ensureUserNotBanned(payload.sub),
    ] as const);

    return { user, currentTokenVersion, sessionActive };
  }

  /** user 缓存命中即复用；未命中回源数据库并异步回填（与原 resolveUser 同路径）。 */
  private async resolveUserFromRaw(
    rawUser: string | null,
    userId: number,
  ): Promise<ResolvedAuthUserRecord | null> {
    const cached = this.authUserCacheService.parseCachedUser(rawUser);
    if (cached) {
      return cached;
    }

    return this.authUserCacheService.loadUserFromDatabase(userId);
  }
}
