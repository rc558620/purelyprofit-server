import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../../redis/redis.service';
import type { SpaceCountdownFeeModeValue, SpaceTimeFeeModeValue } from './dto/space-session.dto';
import type { SpaceSessionCheckoutLockPayload } from './space-sessions.types';

const DEFAULT_SPACE_SESSION_CHECKOUT_LOCK_TTL_SECONDS = 5 * 60;

@Injectable()
export class SpaceSessionCheckoutLockService {
  constructor(private readonly redisService: RedisService) {}

  async createLock(params: {
    payload: Omit<SpaceSessionCheckoutLockPayload, 'expiresAt'>;
    ttlSeconds?: number;
  }): Promise<{
    lockId: string;
    expiresAt: number;
    payload: SpaceSessionCheckoutLockPayload;
  }> {
    const ttlSeconds =
      params.ttlSeconds ?? DEFAULT_SPACE_SESSION_CHECKOUT_LOCK_TTL_SECONDS;
    const lockId = this.generateLockId();
    const expiresAt = params.payload.lockedAt + ttlSeconds * 1000;
    const payload: SpaceSessionCheckoutLockPayload = {
      ...params.payload,
      expiresAt,
    };

    await this.redisService.set(
      this.buildCheckoutLockKey(lockId),
      JSON.stringify(payload),
      ttlSeconds,
    );

    return {
      lockId,
      expiresAt,
      payload,
    };
  }

  async requireValidLock(params: {
    sessionId: number;
    lockId: string;
    sessionUpdatedAt: number;
    timeFeeMode?: SpaceTimeFeeModeValue;
    countdownFeeMode?: SpaceCountdownFeeModeValue;
  }): Promise<SpaceSessionCheckoutLockPayload> {
    const raw = await this.redisService.get(
      this.buildCheckoutLockKey(params.lockId),
    );

    if (!raw) {
      throw new BadRequestException('锁单已失效，请重新预览后再结账');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('锁单数据异常，请重新预览后再结账');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('锁单数据异常，请重新预览后再结账');
    }

    const payload = parsed as Record<string, unknown>;
    if (
      typeof payload.sessionId !== 'number' ||
      typeof payload.lockedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' ||
      typeof payload.sessionUpdatedAt !== 'number'
    ) {
      throw new BadRequestException('锁单数据异常，请重新预览后再结账');
    }

    if (payload.sessionId !== params.sessionId) {
      throw new BadRequestException('锁单与当前会话不匹配');
    }
    if (payload.sessionUpdatedAt !== params.sessionUpdatedAt) {
      throw new BadRequestException('会话内容已变化，请重新预览后再结账');
    }

    const lockedTimeFeeMode =
      payload.timeFeeMode === 'timed' || payload.timeFeeMode === 'unit_price'
        ? payload.timeFeeMode
        : undefined;
    const lockedCountdownFeeMode =
      payload.countdownFeeMode === 'timed' ||
      payload.countdownFeeMode === 'fixed'
        ? payload.countdownFeeMode
        : undefined;

    if (
      params.timeFeeMode !== undefined &&
      lockedTimeFeeMode !== undefined &&
      lockedTimeFeeMode !== params.timeFeeMode
    ) {
      throw new BadRequestException('结账口径已变化，请重新预览后再结账');
    }
    if (
      params.countdownFeeMode !== undefined &&
      lockedCountdownFeeMode !== undefined &&
      lockedCountdownFeeMode !== params.countdownFeeMode
    ) {
      throw new BadRequestException('结账口径已变化，请重新预览后再结账');
    }

    return {
      sessionId: payload.sessionId,
      lockedAt: payload.lockedAt,
      expiresAt: payload.expiresAt,
      sessionUpdatedAt: payload.sessionUpdatedAt,
      ...(lockedTimeFeeMode ? { timeFeeMode: lockedTimeFeeMode } : {}),
      ...(lockedCountdownFeeMode
        ? { countdownFeeMode: lockedCountdownFeeMode }
        : {}),
    };
  }

  async deleteLock(lockId: string): Promise<void> {
    await this.redisService.del(this.buildCheckoutLockKey(lockId));
  }

  private generateLockId(): string {
    return `space_lock_${randomUUID()}`;
  }

  private buildCheckoutLockKey(lockId: string): string {
    return `space:checkout-lock:${lockId}`;
  }
}
