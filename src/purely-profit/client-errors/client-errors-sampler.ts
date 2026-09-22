/**
 * 采样跟踪的最大 key 数量。
 *
 * aggregateKey 由客户端可控内容参与生成，若不加上限，
 * 构造大量不同 key 的请求会让跟踪表无限增长（内存泄漏）。
 */
const MAX_TRACKED_KEYS = 5000;
/** 达到上限时一次性淘汰的比例 */
const EVICTION_RATIO = 0.2;

interface SampleBucket {
  windowStart: number;
  logged: number;
  suppressed: number;
}

export interface SampleDecision {
  action: 'log' | 'suppress';
  /**
   * 上一窗口被抑制的条数。仅在新窗口的首条上报时返回，
   * 用于输出一条汇总日志，让「被压掉多少」这个信号不至于完全丢失。
   */
  suppressedSummary?: number;
}

/**
 * 按 aggregateKey 做时间窗采样降噪。
 *
 * 同一个 bug 在 N 个客户端同时触发会产生 N 条几乎相同的日志，
 * 既淹没其它错误也放大日志成本。窗口内只放行前 maxPerWindow 条，
 * 其余只计数；窗口结束后的首条上报会带出被抑制的总数。
 *
 * 刻意使用**进程内**计数而非 Redis：
 * - 降噪是尽力而为的优化，不需要精确（集群下实际放行量 ≈ worker 数 × maxPerWindow）；
 * - 遥测链路不该依赖 Redis 可用性，Redis 故障时必须照常落日志。
 */
export class ClientErrorSampler {
  private readonly buckets = new Map<string, SampleBucket>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPerWindow: number,
  ) {}

  acquire(key: string, now: number = Date.now()): SampleDecision {
    if (this.windowMs <= 0 || this.maxPerWindow <= 0) {
      return { action: 'log' };
    }

    const bucket = this.buckets.get(key);
    if (!bucket) {
      this.track(key, { windowStart: now, logged: 1, suppressed: 0 });
      return { action: 'log' };
    }

    if (now - bucket.windowStart >= this.windowMs) {
      const suppressedCount = bucket.suppressed;
      this.buckets.delete(key);
      this.track(key, { windowStart: now, logged: 1, suppressed: 0 });

      return suppressedCount > 0
        ? { action: 'log', suppressedSummary: suppressedCount }
        : { action: 'log' };
    }

    if (bucket.logged < this.maxPerWindow) {
      bucket.logged += 1;
      return { action: 'log' };
    }

    bucket.suppressed += 1;
    return { action: 'suppress' };
  }

  private track(key: string, bucket: SampleBucket): void {
    if (this.buckets.size >= MAX_TRACKED_KEYS) {
      this.evictOldest();
    }

    this.buckets.set(key, bucket);
  }

  /** Map 保持插入顺序，删除最早插入的一批即为近似 LRU */
  private evictOldest(): void {
    const evictTarget = Math.ceil(MAX_TRACKED_KEYS * EVICTION_RATIO);
    let evicted = 0;

    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      evicted += 1;
      if (evicted >= evictTarget) {
        break;
      }
    }
  }
}
