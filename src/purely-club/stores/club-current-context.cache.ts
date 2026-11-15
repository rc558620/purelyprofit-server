/**
 * purely-club 请求上下文（可访问门店 + 选中门店）的进程内 TTL 缓存。
 *
 * 为什么需要：`ClubCurrentContextInterceptor` 挂在所有 club 受保护接口上，
 * 每个请求都要解析一次「当前门店」，原实现固定消耗 2 次 Redis 往返
 * （可访问门店 GET + 选中门店 GET）。小程序首页一次进场的并发请求通常有
 * 5~8 个，等于每次打开页面多出 10~16 次纯重复的 Redis RTT。
 *
 * 本缓存只做**极短窗口**的合并，不替代 Redis：
 * - 命中：本实例 1s 内的连续请求完全不碰 Redis；
 * - 未命中：仍走「一次 MGET 合并两个 key」+ 未命中才回源的路径。
 *
 * 为什么 TTL 只取 1s（资金安全优先）：
 * 选中门店决定充值 / 储值 / 下单的资金归属，不允许长窗口滞后。1s 的可见延迟
 * 远小于 Redis 层现有窗口（门店列表 60s、选中门店 30 天），且切换门店时
 * `switchCurrentStore` 会主动删除本实例条目；跨实例最多滞后 1s，此时
 * `requireCurrentContext` 的 requestedStoreId 校验会以 STORE_CHANGED 拦截，
 * 不会把资金静默记到旧门店。
 */

import { Injectable } from '@nestjs/common';
import type { ClubAccessibleStoreRecord } from './club-stores.types';

/** 缓存有效期（毫秒）：仅用于合并同一用户的连续并发请求 */
export const CLUB_CURRENT_CONTEXT_CACHE_TTL_MS = 1_000;

/** 条目上限：C 端会员数远大于门店数，超限先清过期项，再淘汰最早写入项 */
export const CLUB_CURRENT_CONTEXT_CACHE_MAX_USERS = 5_000;

/** 上下文快照：可访问门店列表 + 用户显式选中的门店 ID（null 表示未选） */
export interface ClubCurrentContextSnapshot {
  stores: ClubAccessibleStoreRecord[];
  selectedStoreId: number | null;
}

interface ClubCurrentContextCacheEntry extends ClubCurrentContextSnapshot {
  cachedAt: number;
}

/** 用户粒度上下文 TTL 缓存（每个 service 实例一份） */
export class ClubCurrentContextTtlCache {
  private readonly entries = new Map<number, ClubCurrentContextCacheEntry>();

  constructor(
    private readonly ttlMs: number = CLUB_CURRENT_CONTEXT_CACHE_TTL_MS,
    private readonly maxUsers: number = CLUB_CURRENT_CONTEXT_CACHE_MAX_USERS,
  ) {}

  /** 命中返回快照（只读，调用方禁止修改内部数组），未命中或已过期返回 null */
  get(userId: number): ClubCurrentContextSnapshot | null {
    const entry = this.entries.get(userId);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.cachedAt >= this.ttlMs) {
      this.entries.delete(userId);
      return null;
    }

    return { stores: entry.stores, selectedStoreId: entry.selectedStoreId };
  }

  set(userId: number, snapshot: ClubCurrentContextSnapshot): void {
    if (this.entries.size >= this.maxUsers) {
      this.prune(Date.now());
      if (this.entries.size >= this.maxUsers) {
        const oldestUserId = this.entries.keys().next().value;
        if (oldestUserId !== undefined) {
          this.entries.delete(oldestUserId);
        }
      }
    }

    this.entries.set(userId, { ...snapshot, cachedAt: Date.now() });
  }

  /** 主动失效：切换门店、加入门店、可访问门店缓存被清时同步调用 */
  delete(userId: number): void {
    this.entries.delete(userId);
  }

  /** 清空（测试与运维排查用） */
  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    for (const [userId, entry] of this.entries) {
      if (now - entry.cachedAt >= this.ttlMs) {
        this.entries.delete(userId);
      }
    }
  }
}

/**
 * 以 Nest provider 形式共享的进程内上下文缓存。
 *
 * 由 `ClubCurrentStoreContextService`（读 / 写 / 失效）与
 * `ClubStoreAccessService`（会员关系变化时失效）共同注入同一个实例，
 * 避免两个 service 互相依赖形成循环。
 */
@Injectable()
export class ClubCurrentContextCache extends ClubCurrentContextTtlCache {}
