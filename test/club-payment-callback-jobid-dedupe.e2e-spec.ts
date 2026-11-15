import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { createBullMqConnection } from '../src/queue/queue-bullmq.config';
import {
  buildClubPaymentCallbackJobKey,
  CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS,
} from '../src/purely-club/payments/club-payment-callback-queue.constants';
import type { ClubPaymentCallbackJobData } from '../src/queue/club-payment-callback.types';

/**
 * 真实 Redis E2E：微信支付回调任务的 jobId 去重语义（3-B-6）。
 *
 * mock 单测只能证明「传进去的 jobId 一样」，证明不了 BullMQ 真的会去重——
 * 这取决于 lua 脚本 `addStandardJob` / `handleDuplicatedJob` 的行为。
 * 这里用与生产同一套 jobId 构造 + 同一份默认任务选项，在真实 Redis 上验证三件事：
 * 1. 同一 orderNo 重复入队只留 1 个任务，且 job 数据不被后来者覆盖；
 * 2. 同一 orderNo 换 transactionId 重投（手工重放）仍然只有 1 个任务；
 * 3. 不同 orderNo 不会被误去重（去重键是「按单」而不是「全量」）。
 *
 * 使用独立队列名，避免污染生产队列 `club-payment-callback`；结束时 obliterate。
 */
describe('支付回调任务 jobId 去重 (e2e, real redis)', () => {
  const TEST_QUEUE_NAME = 'club-payment-callback-e2e-dedupe';

  const envConfig = new ConfigService();
  const configService = {
    get: (key: string): unknown => {
      switch (key) {
        case 'redis.host':
          return envConfig.get<string>('REDIS_HOST') ?? 'localhost';
        case 'redis.port':
          return Number(envConfig.get<string>('REDIS_PORT') ?? 6379);
        case 'redis.password':
          return envConfig.get<string>('REDIS_PASSWORD') ?? '';
        case 'redis.db':
          return Number(envConfig.get<string>('REDIS_DB') ?? 0);
        case 'redis.connectTimeoutMs':
          return 5_000;
        default:
          return undefined;
      }
    },
  } as ConfigService;

  const makeData = (
    orderNo: string,
    transactionId: string,
  ): ClubPaymentCallbackJobData => ({
    orderNo,
    settlementParams: {
      amountFen: 50_000,
      transactionId,
      paidAtMs: 1_781_000_000_000,
      callbackReceivedAtMs: 1_781_000_001_000,
    },
  });

  const ORDER_NO = 'RC202606101231000001A2B';

  let queue: Queue<ClubPaymentCallbackJobData>;
  let connection: Redis;

  beforeAll(async () => {
    connection = createBullMqConnection(configService);
    queue = new Queue<ClubPaymentCallbackJobData>(TEST_QUEUE_NAME, {
      connection,
      defaultJobOptions: CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS,
    });
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    if (connection) {
      connection.disconnect();
    }
  });

  it('同一 orderNo 重复入队只保留 1 个任务，且 job 数据不被覆盖', async () => {
    const jobKey = buildClubPaymentCallbackJobKey(ORDER_NO);

    const first = await queue.add(jobKey, makeData(ORDER_NO, 'wxTx_FIRST'), {
      jobId: jobKey,
    });
    const second = await queue.add(jobKey, makeData(ORDER_NO, 'wxTx_FIRST'), {
      jobId: jobKey,
    });

    // BullMQ 对已存在的 jobId 直接返回旧 id，不新建任务
    expect(second.id).toBe(first.id);

    const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
    expect(counts.waiting).toBe(1);
    expect(counts.active).toBe(0);
    expect(counts.delayed).toBe(0);
  });

  it('同一 orderNo 换 transactionId 重投仍然只有 1 个任务，transactionId 不被覆盖', async () => {
    const jobKey = buildClubPaymentCallbackJobKey(ORDER_NO);

    const replay = await queue.add(jobKey, makeData(ORDER_NO, 'wxTx_REPLAY'), {
      jobId: jobKey,
    });

    const stored = await queue.getJob(jobKey);
    expect(stored).toBeDefined();
    expect(replay.id).toBe(stored?.id);
    // 落账以首次任务为准；重复回调不会用新 transactionId 改写已入队任务
    expect(stored?.data.settlementParams.transactionId).toBe('wxTx_FIRST');
    expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
  });

  it('不同 orderNo 不会被误去重（去重键按单生效）', async () => {
    const otherOrderNo = 'RC202606101231000009Z9Z';
    const otherKey = buildClubPaymentCallbackJobKey(otherOrderNo);

    await queue.add(otherKey, makeData(otherOrderNo, 'wxTx_OTHER'), {
      jobId: otherKey,
    });

    expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 2 });
  });

  it('队列默认任务选项已落到任务上（重试与保留策略不依赖入队侧传参）', async () => {
    const jobKey = buildClubPaymentCallbackJobKey(ORDER_NO);
    const job = await queue.getJob(jobKey);

    expect(job?.opts.attempts).toBe(5);
    expect(job?.opts.backoff).toEqual({ type: 'exponential', delay: 2_000 });
    expect(job?.opts.removeOnComplete).toEqual({ age: 86_400, count: 10_000 });
    expect(job?.opts.removeOnFail).toEqual({ age: 604_800, count: 10_000 });
  });
});
