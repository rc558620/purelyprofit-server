import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { ChainableCommander, RedisOptions } from 'ioredis';
import { buildRedisConnectionOptions } from '../shared/redis-connection.utils';
import {
  createRedisOpsContext,
  RedisCommandObserver,
} from './redis-command-observer';
import type { RedisOpsContext } from './redis-command-observer';
import {
  readHashJson,
  readHashJsonAll,
  writeHashJson,
} from './redis-hash.util';
import {
  deleteKey,
  deleteKeys,
  keyExists,
  readJsonList,
  readStrings,
  scanKeys,
} from './redis-key.util';
import { deleteByPattern, deleteByPatterns } from './redis-pattern-delete.util';
import type { PatternDeleteOptions } from './redis-pattern-delete.util';
import {
  executeReadPipeline as runReadPipeline,
  executeWritePipeline,
} from './redis-pipeline.util';
import type { ReadPipelineResult } from './redis-pipeline.util';
import {
  duplicatePubSubClients,
  publishMessage,
  subscribeChannel,
} from './redis-pubsub.util';
import {
  addSetMember,
  addSetMembers,
  readSetMembers,
  removeSetMembers,
} from './redis-set.util';
import {
  addSortedMember,
  readSortedCard,
  readSortedRange,
  readSortedScore,
  removeSortedByRank,
} from './redis-sorted-set.util';
import {
  expireKey,
  incrementCounter,
  readJson,
  readJsonAndDelete,
  readString,
  setKeyIfAbsent,
  writeJson,
  writeString,
} from './redis-string.util';
import { runScript } from './redis-script.util';

/**
 * 供 ThrottlerModule 等基础设施装配创建独立 Redis 客户端。
 * Redis 客户端构造统一收敛在基础设施层，装配层不再直接 new Redis()。
 */
export function createRedisClient(options: RedisOptions): Redis {
  return new Redis(options);
}

/**
 * Redis 统一访问入口。
 *
 * 本类只保留连接生命周期、门面编排与命令分组装配；
 * 具体命令实现按数据结构拆分在 `redis-*-util.ts`，埋点由
 * `RedisCommandObserver` 统一承担，避免单文件继续膨胀。
 */
@Injectable()
export class RedisService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RedisService.name);
  private readonly observer: RedisCommandObserver;
  private client!: Redis;
  private ops!: RedisOpsContext;
  private readonly slowRedisLogEnabled: boolean;
  private readonly slowRedisThresholdMs: number;
  private readonly patternDeleteOptions: PatternDeleteOptions;

  constructor(private readonly configService: ConfigService) {
    this.slowRedisLogEnabled =
      this.configService.get<boolean>('app.slowRedisLogEnabled') ?? true;
    this.slowRedisThresholdMs =
      this.configService.get<number>('app.slowRedisThresholdMs') ?? 20;
    this.observer = new RedisCommandObserver(this.logger, {
      slowLogEnabled: this.slowRedisLogEnabled,
      slowThresholdMs: this.slowRedisThresholdMs,
    });
    this.patternDeleteOptions = {
      logger: this.logger,
      slowLogEnabled: this.slowRedisLogEnabled,
      slowThresholdMs: this.slowRedisThresholdMs,
    };
  }

  onModuleInit(): void {
    this.client = this.createClient();
    this.ops = createRedisOpsContext(this.client, this.observer);
    this.registerConnectionListeners();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  isReady(): boolean {
    return this.client.status === 'ready';
  }

  isConnectionClosedError(error: unknown): boolean {
    return error instanceof Error && error.message === 'Connection is closed.';
  }

  // ── 字符串 / JSON ────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    return readString(this.ops, key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    return readJson<T>(this.ops, key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await writeString(this.ops, key, value, ttlSeconds);
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    await writeJson(this.ops, key, value, ttlSeconds);
  }

  /** 原子递增；key 首次创建时才设置 TTL，返回递增后的值 */
  async incr(key: string, ttlSecondsOnCreate?: number): Promise<number> {
    return incrementCounter(this.ops, key, ttlSecondsOnCreate);
  }

  /** 设置 key 过期时间（秒）；key 不存在返回 false */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    return expireKey(this.ops, key, ttlSeconds);
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    return setKeyIfAbsent(this.ops, key, value, ttlSeconds);
  }

  /** 原子获取并删除（GETDEL），用于 refresh token 轮换等场景 */
  async getJsonAndDelete<T>(key: string): Promise<T | null> {
    return readJsonAndDelete<T>(this.ops, key);
  }

  /**
   * 执行 Lua 脚本（EVAL）。
   *
   * 需要「读 → 判断 → 写」原子完成时使用（并发抢占、条件更新），
   * 避免 get 后 set 的竞态窗口被并发请求同时穿过。
   */
  async evalScript(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    return runScript(this.ops, script, keys, args);
  }

  // ── Hash ─────────────────────────────────────────────────

  /** 读取 hash 字段的 JSON 值（字段不存在返回 null） */
  async hgetJson<T>(key: string, field: string): Promise<T | null> {
    return readHashJson<T>(this.ops, key, field);
  }

  /** 写入 hash 字段并可选刷新整键 TTL（HSET + EXPIRE 合并为一次往返） */
  async hsetJson(
    key: string,
    field: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    await writeHashJson(this.ops, key, { field, value, ttlSeconds });
  }

  /** 一次往返读取 hash 全部字段的 JSON 值 */
  async hgetAllJson<T>(key: string): Promise<Record<string, T>> {
    return readHashJsonAll<T>(this.ops, key);
  }

  // ── Pipeline ─────────────────────────────────────────────

  /**
   * 以 pipeline 执行一组互不依赖的命令，合并为一次网络往返。
   *
   * 业务侧把「签发令牌 + 清除失败计数」这类无依赖的写操作丢进同一个 pipeline，
   * 热路径上的串行 RTT 就能摊平。pipeline 不保证原子性，需要原子性请用 multi。
   */
  async executePipeline(
    build: (pipeline: ChainableCommander) => void,
  ): Promise<void> {
    await this.ops.observe('PIPELINE', () =>
      executeWritePipeline(this.client, build),
    );
  }

  /**
   * 用一次 pipeline 往返执行一组互不依赖的只读命令，返回与提交顺序一致的原始回复。
   *
   * 鉴权链路的 user 缓存 / token 版本 / 会话活性（ZSCORE）/ 关联门店 ID 彼此无依赖，
   * 却各自一次往返；合并成 pipeline 后往返次数从 4 次降到 1 次。
   * ZSCORE 是 sorted set 命令、塞不进 MGET，所以这里用 pipeline 而不是 MGET。
   *
   * `ok === false` 时调用方必须降级为逐条读取，禁止当成缓存未命中。
   */
  async executeReadPipeline(
    build: (pipeline: ChainableCommander) => void,
  ): Promise<ReadPipelineResult> {
    return this.ops.observe('PIPELINE', () =>
      runReadPipeline(this.client, build),
    );
  }

  // ── 键级操作 ─────────────────────────────────────────────

  async exists(key: string): Promise<boolean> {
    return keyExists(this.ops, key);
  }

  async del(key: string): Promise<void> {
    await deleteKey(this.ops, key);
  }

  async delMany(keys: string[]): Promise<number> {
    return deleteKeys(this.ops, keys);
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return readStrings(this.ops, keys);
  }

  async mgetJson<T>(keys: string[]): Promise<(T | null)[]> {
    return readJsonList<T>(this.ops, keys);
  }

  async scanKeysByPattern(pattern: string, limit?: number): Promise<string[]> {
    return scanKeys(this.ops, pattern, limit);
  }

  /** 用 SCAN + pipeline UNLINK 删除单个模式命中的 key */
  async delByPattern(pattern: string): Promise<number> {
    return deleteByPattern(this.client, pattern, this.patternDeleteOptions);
  }

  /**
   * 一次 keyspace 遍历删除多个模式的 key。
   *
   * 仅含 `*` 的模式走合并路径；含 `?` / `[]` / `\` 的复杂模式分流回
   * delByPattern，由 Redis 服务端 MATCH 保证语义，避免客户端匹配分叉。
   */
  async delByPatterns(patterns: string[]): Promise<number> {
    return deleteByPatterns(this.client, patterns, this.patternDeleteOptions);
  }

  // ── Sorted Set ───────────────────────────────────────────

  async zadd(
    key: string,
    score: number,
    member: string,
    ttlSeconds?: number,
  ): Promise<void> {
    await addSortedMember(this.ops, key, { score, member, ttlSeconds });
  }

  async zremrangebyrank(
    key: string,
    start: number,
    stop: number,
  ): Promise<number> {
    return removeSortedByRank(this.ops, key, start, stop);
  }

  async zscore(key: string, member: string): Promise<string | null> {
    return readSortedScore(this.ops, key, member);
  }

  async zcard(key: string): Promise<number> {
    return readSortedCard(this.ops, key);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return readSortedRange(this.ops, key, start, stop);
  }

  // ── Set ──────────────────────────────────────────────────

  /** 向 set 中添加成员，可选刷新 TTL（秒） */
  async sadd(key: string, member: string, ttlSeconds?: number): Promise<void> {
    await addSetMember(this.ops, key, member, ttlSeconds);
  }

  /** 批量向 set 中添加成员，可选刷新 TTL（秒）；members 为空时跳过 */
  async saddMany(
    key: string,
    members: string[],
    ttlSeconds?: number,
  ): Promise<void> {
    await addSetMembers(this.ops, key, members, ttlSeconds);
  }

  /** 读取 set 全部成员；key 不存在时返回空数组 */
  async smembers(key: string): Promise<string[]> {
    return readSetMembers(this.ops, key);
  }

  /** 从 set 中移除成员（原子操作）；members 为空时跳过 */
  async srem(key: string, ...members: string[]): Promise<void> {
    await removeSetMembers(this.ops, key, members);
  }

  // ── Pub/Sub 与就绪检查 ───────────────────────────────────

  async publish(channel: string, message: string): Promise<number> {
    return publishMessage(this.ops, channel, message);
  }

  createPubSubClients(): { publisher: Redis; subscriber: Redis } {
    return duplicatePubSubClients(this.client);
  }

  async subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<() => Promise<void>> {
    return subscribeChannel(this.client, this.logger, channel, listener);
  }

  async checkReadiness(): Promise<void> {
    const pong = await this.ops.observe('PING', () => this.client.ping());
    if (pong !== 'PONG') {
      throw new Error(`unexpected redis ping response: ${String(pong)}`);
    }
  }

  getClient(): Redis {
    return this.client;
  }

  /** 连接事件统一在此注册，便于生命周期方法保持精简 */
  private registerConnectionListeners(): void {
    this.client.on('error', (error: Error) => {
      this.logger.error(
        `[redis] connection error: ${error.message}`,
        error.stack,
      );
    });

    this.client.on('close', () => {
      this.logger.warn(
        '[redis] connection closed, will attempt reconnect via retryStrategy',
      );
    });

    this.client.on('reconnecting', () => {
      this.logger.log('[redis] reconnecting...');
    });

    this.client.on('ready', () => {
      this.logger.log('[redis] connection ready');
    });
  }

  private createClient(): Redis {
    const redisOptions = buildRedisConnectionOptions(this.configService);
    const commandTimeout =
      this.configService.get<number>('redis.commandTimeoutMs') ?? 3_000;

    return new Redis({ ...redisOptions, commandTimeout });
  }
}
