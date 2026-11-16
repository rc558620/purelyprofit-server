import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  CLUB_BATCH_DEFAULT_CONCURRENCY,
  runClubBatchWithConcurrency,
} from '../shared/club-batch-concurrency.helper';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';

const LOCK_KEY = 'scan-ordering:payment-expiration:lock';
const LOCK_TTL_MS = 55_000;
const DEFAULT_INTERVAL_MS = 60_000;
const BATCH_SIZE = 100;

@Injectable()
export class ScanOrderingPaymentExpirationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    ScanOrderingPaymentExpirationService.name,
  );
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private lockToken: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly unpaidOrderClosureService: ScanOrderingUnpaidOrderClosureService,
  ) {}

  onModuleInit(): void {
    const intervalMs =
      this.configService.get<number>(
        'scanOrdering.paymentExpirationIntervalMs',
      ) ?? DEFAULT_INTERVAL_MS;
    this.interval = setInterval(() => void this.expireDueOrders(), intervalMs);
    this.interval.unref();
    void this.expireDueOrders();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  async expireDueOrders(): Promise<void> {
    if (this.running) return;
    let locked = false;
    try {
      locked = await this.acquireLock();
      if (!locked) return;
      this.running = true;
      const dueOrders = await this.prisma.scanOrders.findMany({
        where: {
          status: 'pending_payment',
          paymentStatus: 'unpaid',
          paymentExpiresAt: { lte: new Date() },
          deletedAt: null,
        },
        orderBy: { paymentExpiresAt: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, version: true },
      });
      // 逐笔串行时 BATCH_SIZE 笔订单的耗时线性叠加：单笔要开事务改订单/购物车/桌台，
      // 100 笔很容易吃掉整个扫描周期（锁 TTL 55s），导致锁提前失效、另一实例插进来
      // 重复扫描同一批订单。改为固定并发度执行，单笔异常自行捕获，不中断整批。
      await runClubBatchWithConcurrency(
        dueOrders,
        async (order) => {
          try {
            await this.unpaidOrderClosureService.close({
              orderId: order.id,
              expectedVersion: order.version,
              operatorType: 'system',
              reason: '支付超时自动关闭',
            });
          } catch (error: unknown) {
            this.logger.error(
              `关闭扫码点餐超时订单失败 orderId=${order.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
        CLUB_BATCH_DEFAULT_CONCURRENCY,
      );
    } catch (error: unknown) {
      this.logger.error(
        `处理扫码点餐支付超时订单失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
      if (locked) await this.releaseLock();
    }
  }

  private async acquireLock(): Promise<boolean> {
    const token = randomUUID();
    const result = await this.redisService
      .getClient()
      .set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
    if (result !== 'OK') return false;
    this.lockToken = token;
    return true;
  }

  private async releaseLock(): Promise<void> {
    if (!this.lockToken) return;
    await this.redisService
      .getClient()
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
        1,
        LOCK_KEY,
        this.lockToken,
      );
    this.lockToken = null;
  }
}
