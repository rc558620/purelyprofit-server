import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * 单个请求作用域内的预取状态。
 *
 * `values === null` 表示「预取尚未成功完成或已失败」，此时所有 `peekJson` 都返回
 * `undefined`，调用方按原逻辑逐条读取——预取层不允许成为故障点。
 */
interface RedisReadPrefetchScope {
  /** 预取任务；`null` 表示本作用域没有发起过预取 */
  pending: Promise<void> | null;
  /** key → 原始字符串值（`null` 表示该 key 在 Redis 中确认不存在） */
  values: Map<string, string | null> | null;
}

/**
 * 请求级 Redis 只读预取容器（加速层，非事实源）。
 *
 * 解决的问题：一个聚合接口（如 C 端首页）内部往往并发发起多条互不依赖的
 * 单 key GET，每条各占一次网络往返。这些 key 在进入聚合逻辑之前就能算出来，
 * 因此可以在最前面用**一次 MGET** 取回，后续读点直接复用。
 *
 * 三条不可动摇的约束：
 * 1. **只读加速层**：`peekJson` 返回 `undefined` 时，调用方必须回退到原有读取
 *    逻辑。删掉本服务的调用，现有 service 行为完全不变。
 * 2. **生命周期绑定单次调用**：状态由 `run()` 创建，随该次调用的异步上下文
 *    存续，结束即丢弃。两个并发请求各自拿到独立 Map，不会串数据——这是
 *    AsyncLocalStorage 方案唯一的泄漏风险点，已由 spec 显式覆盖。
 * 3. **永不抛错**：MGET 失败、单值 JSON 解析失败都只降级为逐条读取，
 *    绝不让聚合接口因预取失败返回 5xx。
 *
 * 不预取「需要前序结果才能算出的 key」（例如依赖商品版本的商品列表 key、
 * 依赖顾客 ID 的首单资格 key）：那些属于天然第二跳，塞进预取只会让容器
 * 反向依赖业务编排。
 */
@Injectable()
export class RedisReadPrefetchService {
  private readonly logger = new Logger(RedisReadPrefetchService.name);
  private readonly storage = new AsyncLocalStorage<RedisReadPrefetchScope>();

  constructor(private readonly redisService: RedisService) {}

  /**
   * 在独立的预取作用域内执行 `task`。
   *
   * 必须在聚合入口处调用一次，且 `task` 内所有读点共享同一个容器。
   * 每次调用都新建状态对象，作用域结束后容器不可再访问，因此不存在跨请求
   * 复用；同一进程内的并发请求彼此隔离。
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    return this.storage.run({ pending: null, values: null }, task);
  }

  /**
   * 发起一次 MGET 预取。
   *
   * 不 `await`、不抛错：调用方可以紧接着并发发起其它分支，读点按需
   * `await peekJson` 即可，不会把入口串行化。重复调用（首个生效）与空 key
   * 列表都是安全的 no-op。未运行在 `run()` 作用域内时同样 no-op。
   */
  start(keys: readonly string[]): void {
    const scope = this.storage.getStore();
    if (!scope || scope.pending || keys.length === 0) {
      return;
    }

    scope.pending = this.fill(scope, [...new Set(keys)]);
  }

  /** 预取任务体：写入成功结果，失败时 `values` 保持 `null`（整体降级）。 */
  private async fill(
    scope: RedisReadPrefetchScope,
    keys: readonly string[],
  ): Promise<void> {
    scope.values = await this.load(keys);
  }

  /**
   * 读取预取结果。
   *
   * @returns `undefined` — 本 key 未被预取 / 预取失败 / 解析失败，
   *            调用方必须回退原有读取；
   *          `null` — 已预取且确认不存在（等价于普通 GET 未命中）；
   *          其它 — 已预取并解析成功的值。
   */
  async peekJson<T>(key: string): Promise<T | null | undefined> {
    const scope = this.storage.getStore();
    if (!scope?.pending) {
      return undefined;
    }

    await scope.pending;
    if (scope.values === null || !scope.values.has(key)) {
      return undefined;
    }

    const raw = scope.values.get(key) ?? null;
    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(
        `预取缓存值解析失败 key=${key}，回退逐条读取: ${this.toMessage(error)}`,
      );
      return undefined;
    }
  }

  /** 执行 MGET；失败返回 `null` 表示整体降级。 */
  private async load(
    keys: readonly string[],
  ): Promise<Map<string, string | null> | null> {
    try {
      const rawValues = await this.redisService.mget([...keys]);
      const values = new Map<string, string | null>();
      keys.forEach((key, index) => {
        values.set(key, rawValues[index] ?? null);
      });
      return values;
    } catch (error) {
      this.logger.warn(
        `批量预取失败，降级为逐条读取 keys=${keys.length}: ${this.toMessage(error)}`,
      );
      return null;
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
