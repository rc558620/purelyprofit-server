// 扫码点餐超时自动退款服务：定时扫描「超时未接单」「超时未出餐」的订单并系统自动退款
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { ScanOrderStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { ScanOrderingOrderRefundHandlingService } from './scan-ordering-order-refund.service';

const LOCK_KEY = 'scan-ordering:acceptance-expiration:lock';
const LOCK_TTL_MS = 10 * 60_000;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_RETRY_DELAY_MS = 5 * 60_000;
const DEFAULT_MAX_RETRIES = 3;
/** 待接单超时阈值（支付后超过该时长未接单即自动退款）。 */
const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 30 * 60 * 1000;
/** 制作中超时阈值（接单后超过该时长未出餐即自动退款）。 */
const DEFAULT_PREPARING_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

/** 待扫描的超时订单候选。 */
interface TimeoutOrderCandidate {
  id: number;
  storeId: number;
  version: number;
  /** 是否为手工补录单：超时后仅置拒绝并记账，不触发真实退款 */
  manualEntry: boolean;
}

/**
 * 扫码点餐超时自动退款定时服务。
 *
 * 扫描规则：
 * - 待接单超时：status=pending_acceptance 且 paidAt ≤ now - 30min（商家超时未接单）；
 * - 制作中超时：status=preparing 且 acceptedAt ≤ now - 2h（商家超时未出餐）。
 * 扫码单与手工录入单均参与扫描；手工单超时仅走「置拒绝 + 记账」链路
 * （真实退款由商家线下处理），扫码单走完整自动退款链路。
 *
 * 通过 Redis 分布式锁保证多实例部署下仅一个实例执行扫描；
 * 逐单委托 ScanOrderingOrderRefundHandlingService 处理。
 */
@Injectable()
export class ScanOrderingAcceptanceExpirationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    ScanOrderingAcceptanceExpirationService.name,
  );
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private lockToken: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly refundHandlingService: ScanOrderingOrderRefundHandlingService,
  ) {}

  onModuleInit(): void {
    const intervalMs =
      this.configService.get<number>(
        'scanOrdering.acceptanceExpirationIntervalMs',
      ) ?? DEFAULT_INTERVAL_MS;
    this.interval = setInterval(() => void this.expireDueOrders(), intervalMs);
    this.interval.unref();
    void this.expireDueOrders();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  /** 扫描并处理到期订单（加分布式锁，防多实例并发重复退款）。 */
  async expireDueOrders(): Promise<void> {
    if (this.running) return;
    let locked = false;
    try {
      locked = await this.acquireLock();
      if (!locked) return;
      this.running = true;
      await this.expireAcceptanceOrders();
      await this.expirePreparingOrders();
      await this.retryRefundingOrders();
    } catch (error: unknown) {
      this.logger.error(
        `处理扫码点餐超时自动退款失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
      if (locked) await this.releaseLock();
    }
  }

  /** 扫描待接单超时订单（支付后 30 分钟未接单）。 */
  private async expireAcceptanceOrders(): Promise<void> {
    const timeoutMs =
      this.configService.get<number>('scanOrdering.acceptanceTimeoutMs') ??
      DEFAULT_ACCEPTANCE_TIMEOUT_MS;
    const candidates = await this.findCandidates(
      'pending_acceptance',
      'paidAt',
      timeoutMs,
    );
    await this.processCandidates(
      candidates,
      'pending_acceptance',
      '商家超时未接单，系统自动退款',
    );
  }

  /** 扫描制作中超时订单（接单后 2 小时未出餐）。 */
  private async expirePreparingOrders(): Promise<void> {
    const timeoutMs =
      this.configService.get<number>('scanOrdering.preparingTimeoutMs') ??
      DEFAULT_PREPARING_TIMEOUT_MS;
    const candidates = await this.findCandidates(
      'preparing',
      'acceptedAt',
      timeoutMs,
    );
    await this.processCandidates(
      candidates,
      'preparing',
      '商家超时未出餐，系统自动退款',
    );
  }

  private async processCandidates(
    candidates: TimeoutOrderCandidate[],
    fromStatus: Extract<ScanOrderStatus, 'pending_acceptance' | 'preparing'>,
    reason: string,
  ): Promise<void> {
    const concurrency = this.getPositiveConfig(
      'scanOrdering.acceptanceExpirationConcurrency',
      DEFAULT_CONCURRENCY,
    );
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < candidates.length) {
        const candidate = candidates[nextIndex++];
        await this.refundCandidate(candidate, fromStatus, reason);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, candidates.length) }, () =>
        worker(),
      ),
    );
  }

  private getPositiveConfig(key: string, fallback: number): number {
    const value = this.configService.get<number>(key);
    return value && Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private async retryRefundingOrders(): Promise<void> {
    const retryDelayMs = this.getPositiveConfig(
      'scanOrdering.acceptanceExpirationRetryDelayMs',
      DEFAULT_RETRY_DELAY_MS,
    );
    const maxRetries = this.getPositiveConfig(
      'scanOrdering.acceptanceExpirationMaxRetries',
      DEFAULT_MAX_RETRIES,
    );
    const candidates = await this.prisma.scanOrderRefundTask.findMany({
      where: {
        triggerType: 'system_timeout',
        status: 'manual_pending',
        retryCount: { lt: maxRetries },
        updatedAt: { lte: new Date(Date.now() - retryDelayMs) },
        order: { status: 'refunding', paymentStatus: 'refunding' },
      },
      orderBy: { updatedAt: 'asc' },
      take: BATCH_SIZE,
      select: {
        refundNo: true,
        retryCount: true,
        order: { select: { id: true, storeId: true, version: true } },
      },
    });
    await this.processRetryCandidates(candidates, maxRetries);
  }

  private async processRetryCandidates(
    candidates: Array<{
      refundNo: string;
      retryCount: number;
      order: { id: number; storeId: number; version: number };
    }>,
    maxRetries: number,
  ): Promise<void> {
    const concurrency = this.getPositiveConfig(
      'scanOrdering.acceptanceExpirationConcurrency',
      DEFAULT_CONCURRENCY,
    );
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < candidates.length) {
        const candidate = candidates[nextIndex++];
        try {
          await this.refundHandlingService.retryAutoWechatRefund({
            orderId: candidate.order.id,
            storeId: candidate.order.storeId,
            version: candidate.order.version,
            refundNo: candidate.refundNo,
            retryCount: candidate.retryCount,
            maxRetries,
          });
        } catch (error: unknown) {
          this.logger.error(
            `重试扫码点餐退款失败 orderId=${candidate.order.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, candidates.length) }, () =>
        worker(),
      ),
    );
  }

  /** 查询到期待退款订单候选（按时间基准字段升序，优先处理滞留最久的）。
   * 扫码单与手工录入单都纳入扫描；手工单在 refundCandidate 中分流处理。 */
  private findCandidates(
    status: 'pending_acceptance' | 'preparing',
    timeField: 'paidAt' | 'acceptedAt',
    timeoutMs: number,
  ): Promise<TimeoutOrderCandidate[]> {
    return this.prisma.scanOrders.findMany({
      where: {
        status,
        deletedAt: null,
        [timeField]: { lte: new Date(Date.now() - timeoutMs) },
      },
      orderBy: { [timeField]: 'asc' as const },
      take: BATCH_SIZE,
      select: { id: true, storeId: true, version: true, manualEntry: true },
    });
  }

  /** 逐单处理超时订单：手工单仅置拒绝并记账，扫码单走完整自动退款；
   * 乐观锁冲突（商家恰好已接单/已出餐）视为已处理，不中断批次。 */
  private async refundCandidate(
    candidate: TimeoutOrderCandidate,
    fromStatus: Extract<ScanOrderStatus, 'pending_acceptance' | 'preparing'>,
    reason: string,
  ): Promise<void> {
    const input = {
      orderId: candidate.id,
      storeId: candidate.storeId,
      version: candidate.version,
      fromStatus,
      reason,
    };
    try {
      if (candidate.manualEntry) {
        await this.refundHandlingService.autoCloseManualEntryByTimeout(input);
      } else {
        await this.refundHandlingService.autoRefundByTimeout(input);
      }
      this.logger.log(
        `扫码点餐超时处理完成: orderId=${candidate.id}, storeId=${candidate.storeId}, fromStatus=${fromStatus}, manualEntry=${candidate.manualEntry}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `扫码点餐超时处理失败 orderId=${candidate.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
