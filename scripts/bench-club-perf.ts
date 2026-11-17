/**
 * purelyClub 性能基准：本次优化的「优化前 / 优化后」量化对比。
 *
 * 两种口径，互相补充：
 *  A. 离线 IO 口径（无外部依赖）：用 FakePrisma / FakeRedis 记录每次查询/命令，
 *     并注入固定延迟（PG 单次查询默认 5ms、Redis RTT 默认 2ms）。并发发出的
 *     调用会重叠等待，串行调用会累加，因此测出的耗时等价于「依赖链跳数 × 每跳延迟」。
 *     交互式事务按 Prisma 的真实语义建模：所有语句在同一条连接上串行执行。
 *  B. 真实库口径：连本地 PostgreSQL，取真实订单行，对比「改前 include 全行」
 *     与「改后显式投影」实际拉回的列数、字节数与查询耗时。
 *
 * 场景与本次改动一一对应：
 *  1. 积分汇总（calculateSummary）：2 × aggregate → 1 条 FILTER 聚合
 *  2. 会员快照冷启动（getSnapshotByStoreIdentity）：缓存回写阻塞 → 非阻塞
 *  3. 换绑事务（prepareRebindTargets）：同事务重复扫描 → 复用已查结果
 *  4. 自助下单读路径（详情 / 支付摘要 / 支付广播）：include 全行 → 显式投影
 *
 * 运行：node --env-file=.env -r ts-node/register/transpile-only scripts/bench-club-perf.ts
 * 参数：--db-query=5 --redis-rtt=2 --samples=9
 */

import type { Pool as PgPool } from 'pg';
import { Pool } from 'pg';
import { config as loadEnv } from 'dotenv';
import { ClubMemberProfileService } from '../src/purely-club/member/member-profile/club-member-profile.service';
import { ClubPhoneRebindProfilesService } from '../src/purely-club/auth/club-phone-rebind-profiles.service';
import { ClubPointsQueryService } from '../src/purely-club/points/club-points-query.service';
import { RedisReadPrefetchService } from '../src/redis/redis-read-prefetch.service';

/**
 * 真实库连接串：从 .env 的解析结果里取，不在脚本里自行读环境变量
 * （后端读取环境变量的入口统一由 configuration.ts 收口）。
 */
const parsedEnv = loadEnv({ quiet: true }).parsed ?? {};
const DATABASE_URL = parsedEnv.DATABASE_URL ?? '';

/** 读取 `--name=value` 形式的命令行参数；缺省或非法时用默认值 */
const readArgNumber = (name: string, fallback: number): number => {
  const prefix = `--${name}=`;
  const matched = process.argv.find((arg) => arg.startsWith(prefix));
  if (!matched) return fallback;
  const parsed = Number(matched.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DB_QUERY_MS = readArgNumber('db-query', 5);
const REDIS_RTT_MS = readArgNumber('redis-rtt', 2);
const SAMPLES = readArgNumber('samples', 9);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const counters = { dbQueries: 0, redisRoundTrips: 0 };

const resetCounters = (): void => {
  counters.dbQueries = 0;
  counters.redisRoundTrips = 0;
};

// ─── 基础设施替身 ───────────────────────────────────────────────────────

/** 内存版 Redis：只实现快照链路用到的命令，按次计数并注入 RTT */
class FakeRedis {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    return this.store.get(key) ?? null;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  /** TTL 只影响过期时机，基准每次采样都是新实例，接收但不使用 */
  async set(key: string, value: string, _ttlSeconds?: number): Promise<void> {
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    this.store.set(key, value);
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }
}

/** 固定延迟 + 计数的 Prisma 替身（会员快照 / 积分汇总链路） */
class FakePrisma {
  private async tap<T>(result: T): Promise<T> {
    counters.dbQueries += 1;
    await sleep(DB_QUERY_MS);
    return result;
  }

  readonly member = {
    findFirst: async (): Promise<unknown> =>
      this.tap({ id: 9001, createdAt: new Date('2025-01-01T00:00:00.000Z') }),
  };

  readonly marketingCustomer = {
    findFirst: async (): Promise<unknown> =>
      this.tap({
        id: 8001,
        balance: 35000,
        points: 1280,
        tier: 'gold',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      }),
  };

  readonly marketingRecharge = {
    aggregate: async (): Promise<unknown> =>
      this.tap({ _sum: { amount: 320000 } }),
  };

  readonly marketingPointsRecord = {
    /**
     * 改前实现会带上 where / _sum 入参，替身只按固定延迟回一个同形结果，
     * 因此这里接收但不消费参数——签名对齐 Prisma 的 aggregate(args)。
     */
    aggregate: async (_args?: unknown): Promise<unknown> =>
      this.tap({ _sum: { amount: 1240 } }),
  };

  /** FILTER 聚合：一条 SQL 返回一行两个标量 */
  readonly $queryRaw = async (..._args: unknown[]): Promise<unknown[]> =>
    this.tap([{ totalEarned: 1240n, totalRedeemed: -80n }]);
}

/**
 * 事务替身：所有语句在同一条「连接」上串行执行。
 *
 * Prisma 交互式事务共用一条连接，`Promise.all` 并不会真正并行，
 * 因此这里用队列串行化 tap，保证测出的耗时与生产语义一致。
 */
class FakeTx {
  private tail: Promise<void> = Promise.resolve();

  private async tap<T>(result: T): Promise<T> {
    counters.dbQueries += 1;
    const previous = this.tail;
    // 占位 promise：下一条语句必须等本条执行完，模拟单连接串行
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    await sleep(DB_QUERY_MS);
    release();
    return result;
  }

  readonly marketingCustomer = {
    findMany: async (): Promise<unknown[]> =>
      this.tap([{ storeId: 11 }, { storeId: 12 }]),
    updateMany: async (): Promise<unknown> => this.tap({ count: 1 }),
    findFirst: async (): Promise<unknown> => this.tap(null),
  };

  readonly member = {
    findMany: async (): Promise<unknown[]> => this.tap([{ storeId: 11 }]),
    findFirst: async (): Promise<unknown> => this.tap(null),
  };

  readonly user = {
    update: async (): Promise<unknown> => this.tap({ id: 201 }),
  };
}

// ─── 场景测量框架 ───────────────────────────────────────────────────────

interface ScenarioResult {
  label: string;
  dbQueries: number;
  redisRoundTrips: number;
  medianMs: number;
}

/** 每个采样都重建依赖树与空缓存（冷启动口径） */
const measureCold = async (
  label: string,
  create: () => () => Promise<void>,
): Promise<ScenarioResult> => {
  const timings: number[] = [];
  let dbQueries = 0;
  let redisRoundTrips = 0;

  for (let i = 0; i < SAMPLES; i += 1) {
    const task = create();
    resetCounters();
    const startedAt = performance.now();
    await task();
    timings.push(performance.now() - startedAt);
    dbQueries = counters.dbQueries;
    redisRoundTrips = counters.redisRoundTrips;
  }

  return { label, dbQueries, redisRoundTrips, medianMs: median(timings) };
};

const formatDelta = (before: number, after: number): string => {
  if (before === 0) return '—';
  const delta = ((after - before) / before) * 100;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
};

// ─── 场景 1：积分汇总 ──────────────────────────────────────────────────

/** 改前实现复刻：两条互补谓词的 aggregate 并行发出 */
const legacyCalculateSummary = async (
  prisma: FakePrisma,
): Promise<{ totalEarned: number; totalRedeemed: number }> => {
  const [earnedResult, redeemedResult] = await Promise.all([
    prisma.marketingPointsRecord.aggregate({
      where: { storeId: 11, customerId: 8001, amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.marketingPointsRecord.aggregate({
      where: { storeId: 11, customerId: 8001, amount: { lt: 0 } },
      _sum: { amount: true },
    }),
  ]);
  void earnedResult;
  void redeemedResult;
  return { totalEarned: 1240, totalRedeemed: 80 };
};

const createPointsStack = (): (() => Promise<void>) => {
  const prisma = new FakePrisma();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new ClubPointsQueryService(prisma as any);
  return async (): Promise<void> => {
    await service.calculateSummary(11, 8001);
  };
};

const createPointsLegacy = (): (() => Promise<void>) => {
  const prisma = new FakePrisma();
  return async (): Promise<void> => {
    await legacyCalculateSummary(prisma);
  };
};

// ─── 场景 2：会员快照冷启动 ──────────────────────────────────────────────

const createSnapshotStack = (): (() => Promise<void>) => {
  const prisma = new FakePrisma();
  const redis = new FakeRedis();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const redisReadPrefetch = new RedisReadPrefetchService(redis as any);
  const service = new ClubMemberProfileService(
    prisma as any,
    redis as any,
    redisReadPrefetch,
  );
  return async (): Promise<void> => {
    await service.getSnapshotByStoreIdentity(11, 201, '13800138000');
  };
};

/**
 * 改前实现复刻：同样的读取顺序，但缓存回写 `await` 在返回路径上。
 * 结构照搬改动前的 loadSnapshot（读缓存 → 档案并发定位 → 充值聚合 → 写缓存）。
 */
const createSnapshotLegacy = (): (() => Promise<void>) => {
  const prisma = new FakePrisma();
  const redis = new FakeRedis();
  return async (): Promise<void> => {
    const cacheKey = 'club:member:snapshot:11:201';
    const cached = await redis.getJson(cacheKey);
    if (cached !== null) return;
    await Promise.all([
      prisma.member.findFirst(),
      prisma.marketingCustomer.findFirst(),
    ]);
    await prisma.marketingRecharge.aggregate();
    await redis.setJson(cacheKey, { memberId: 9001 }, 15);
  };
};

// ─── 场景 3：手机号换绑事务 ────────────────────────────────────────────

/**
 * 改前实现复刻：claimUnboundCustomers 之后，再按 clubUserId 重查一次
 * marketing_customers（与本事务刚认领的结果只差认领行）。
 */
const legacyPrepareRebindTargets = async (tx: FakeTx): Promise<number[]> => {
  // claimUnboundCustomers：2 查 + 1 写
  await tx.marketingCustomer.findMany();
  await tx.marketingCustomer.findMany();
  await tx.marketingCustomer.updateMany();

  // 门店范围：3 条并发（事务内串行执行）
  await Promise.all([
    tx.marketingCustomer.findMany(),
    tx.member.findMany(),
    tx.member.findMany(),
  ]);

  // 冲突校验：2 条串行
  await tx.marketingCustomer.findFirst();
  await tx.member.findFirst();

  return [11, 12];
};

/** 改后实现：直接复用真实 service 的实现，避免基准与生产代码漂移 */
const createRebindStack = (): (() => Promise<void>) => {
  const tx = new FakeTx();
  // 档案同步已抽离为无依赖子服务，基准直接跑它的真实实现
  const service = new ClubPhoneRebindProfilesService();
  return async (): Promise<void> => {
    await service.prepareRebindTargets(tx as any, {
      userId: 201,
      previousPhone: '13800138000',
      nextPhone: '13900139000',
    });
  };
};

const createRebindLegacy = (): (() => Promise<void>) => {
  const tx = new FakeTx();
  return async (): Promise<void> => {
    await legacyPrepareRebindTargets(tx);
  };
};

// ─── 场景 4：真实库口径（自助下单读路径）───────────────────────────────

interface PayloadResult {
  label: string;
  statements: number;
  columns: number;
  bytes: number;
  medianMs: number;
}

/** 订单详情：改前整行 + 明细整行 */
const DETAIL_BEFORE = [
  'SELECT * FROM self_orders WHERE id = $1',
  'SELECT * FROM self_order_items WHERE order_id = $1',
];
/** 订单详情：改后仅响应契约字段（与 SELF_ORDER_LIST_SELECT 同列） */
const DETAIL_AFTER = [
  `SELECT id, order_no, store_id, session_id, space_id, remark, item_total_amount,
          payable_amount, status, payment_status, version, created_at
     FROM self_orders WHERE id = $1`,
  `SELECT id, product_id, product_name, category_name, sale_price, quantity, spec_signature
     FROM self_order_items WHERE order_id = $1`,
];
/** 支付结果摘要：改前 include 明细（响应根本不消费） */
const SUMMARY_BEFORE = [
  'SELECT * FROM self_orders WHERE id = $1',
  'SELECT * FROM self_order_items WHERE order_id = $1',
];
/** 支付结果摘要：改后 9 列 */
const SUMMARY_AFTER = [
  `SELECT id, order_no, session_id, space_id, status, payment_status,
          payable_amount, paid_at, version
     FROM self_orders WHERE id = $1`,
];
/** 支付成功广播：改前订单整行 + 明细整行 */
const NOTIFY_BEFORE = [
  'SELECT * FROM self_orders WHERE id = $1',
  'SELECT * FROM self_order_items WHERE order_id = $1',
];
/** 支付成功广播：改后 11 列 + 明细 2 列 */
const NOTIFY_AFTER = [
  `SELECT id, store_id, order_no, session_id, space_id, payable_amount, remark,
          paid_at, status, payment_status, version
     FROM self_orders WHERE id = $1`,
  'SELECT product_name, quantity FROM self_order_items WHERE order_id = $1',
];

const runPayloadCase = async (
  pool: PgPool,
  label: string,
  sqls: string[],
  orderId: number,
): Promise<PayloadResult> => {
  const timings: number[] = [];
  let columns = 0;
  let bytes = 0;
  // 单条查询在本地库是亚毫秒级，采样数太少会被计时抖动主导
  const samples = Math.max(SAMPLES, 25);

  for (let i = 0; i < samples; i += 1) {
    const startedAt = performance.now();
    let sampleColumns = 0;
    const rows: unknown[] = [];
    for (const sql of sqls) {
      const result = await pool.query(sql, [orderId]);
      sampleColumns += result.fields.length;
      rows.push(...result.rows);
    }
    timings.push(performance.now() - startedAt);
    columns = sampleColumns;
    bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');
  }

  return {
    label,
    statements: sqls.length,
    columns,
    bytes,
    medianMs: median(timings),
  };
};

const measurePayloads = async (): Promise<void> => {
  const connectionString = DATABASE_URL;
  if (!connectionString) {
    console.log('\n⚠️  未配置 DATABASE_URL，跳过真实库口径。\n');
    return;
  }

  const pool = new Pool({ connectionString, statement_timeout: 10_000 });
  try {
    // 取明细最多的一笔订单，代表最坏情况下的单订单读取成本
    const picked = await pool.query<{ order_id: number; n: number }>(
      `SELECT order_id, COUNT(*)::int AS n
         FROM self_order_items
        GROUP BY order_id
        ORDER BY n DESC
        LIMIT 1`,
    );
    const target = picked.rows[0];
    if (!target) {
      console.log('\n⚠️  self_order_items 无数据，跳过真实库口径。\n');
      return;
    }

    const cases: PayloadResult[] = [];
    const pairs: Array<[string, string[], string[]]> = [
      ['订单详情', DETAIL_BEFORE, DETAIL_AFTER],
      ['支付结果摘要', SUMMARY_BEFORE, SUMMARY_AFTER],
      ['支付成功广播', NOTIFY_BEFORE, NOTIFY_AFTER],
    ];

    for (const [name, before, after] of pairs) {
      cases.push(
        await runPayloadCase(pool, `${name} · 改前`, before, target.order_id),
      );
      cases.push(
        await runPayloadCase(pool, `${name} · 改后`, after, target.order_id),
      );
    }

    console.log(
      `\n真实库口径：本地 PostgreSQL，取明细最多的订单 orderId=${target.order_id}（${target.n} 行明细），` +
        `每场景 ${Math.max(SAMPLES, 25)} 次采样取中位数\n`,
    );
    console.table(
      cases.map((row) => ({
        场景: row.label,
        'SQL 语句数': row.statements,
        拉回列数: row.columns,
        拉回字节数: row.bytes,
        '中位耗时(ms)': Number(row.medianMs.toFixed(2)),
      })),
    );

    for (let i = 0; i < cases.length; i += 2) {
      const before = cases[i];
      const after = cases[i + 1];
      console.log(
        `${before.label.replace(' · 改前', '')}：` +
          `列数 ${before.columns} → ${after.columns}（${formatDelta(before.columns, after.columns)}），` +
          `字节 ${before.bytes} → ${after.bytes}（${formatDelta(before.bytes, after.bytes)}），` +
          `耗时 ${before.medianMs.toFixed(2)}ms → ${after.medianMs.toFixed(2)}ms（${formatDelta(before.medianMs, after.medianMs)}）`,
      );
    }
  } finally {
    await pool.end();
  }
};

// ─── 主流程 ────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const results: ScenarioResult[] = [];

  results.push(
    await measureCold(
      '积分汇总 · 改前（2 × aggregate 并行）',
      createPointsLegacy,
    ),
    await measureCold('积分汇总 · 改后（1 条 FILTER 聚合）', createPointsStack),
    await measureCold(
      '会员快照冷启动 · 改前（回写阻塞返回）',
      createSnapshotLegacy,
    ),
    await measureCold(
      '会员快照冷启动 · 改后（回写非阻塞）',
      createSnapshotStack,
    ),
    await measureCold(
      '换绑事务 prepareRebindTargets · 改前',
      createRebindLegacy,
    ),
    await measureCold(
      '换绑事务 prepareRebindTargets · 改后',
      createRebindStack,
    ),
  );

  console.log(
    `\n模拟延迟：PG 单次查询 ${DB_QUERY_MS}ms / Redis RTT ${REDIS_RTT_MS}ms，每场景 ${SAMPLES} 次采样取中位数`,
  );
  console.log('口径：交互式事务内语句串行执行（与 Prisma 单连接语义一致）\n');
  console.table(
    results.map((row) => ({
      场景: row.label,
      'PG 查询数': row.dbQueries,
      'Redis 往返次数': row.redisRoundTrips,
      '中位耗时(ms)': Number(row.medianMs.toFixed(2)),
    })),
  );

  for (let i = 0; i < results.length; i += 2) {
    const before = results[i];
    const after = results[i + 1];
    const name = before.label.replace(/ · 改前.*$/, '');
    console.log(
      `${name}：` +
        `PG 查询 ${before.dbQueries} → ${after.dbQueries}（${formatDelta(before.dbQueries, after.dbQueries)}），` +
        `Redis 往返 ${before.redisRoundTrips} → ${after.redisRoundTrips}（${formatDelta(before.redisRoundTrips, after.redisRoundTrips)}），` +
        `耗时 ${before.medianMs.toFixed(2)}ms → ${after.medianMs.toFixed(2)}ms（${formatDelta(before.medianMs, after.medianMs)}）`,
    );
  }

  await measurePayloads();
};

void main();
