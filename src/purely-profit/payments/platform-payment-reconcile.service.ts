/**
 * 平台收款对账服务：主动查单 + 补入账，自动补救丢失的支付回调。
 *
 * 背景：平台收款（新客额度充值 / 平台会员开通）此前**只依赖微信回调**入账。
 * 回调一旦丢失（本地隧道地址变更、进程重启、网络抖动），支付单会永久停在
 * pending，表现为「用户已付款、额度 / 会员没到账」，且只能人工补单。
 *
 * 对账口径与 club 充值链路（`ClubRechargeReconciliationService`）对齐：
 *   - 以**微信侧查单结果**为唯一事实来源，逐笔核对；
 *   - 已支付且金额、流水号校验通过 → 走与回调**完全相同**的入账入口补入账并推送；
 *   - 未支付且本地已过期 → 先关微信侧再关本地单，避免二维码仍在有效期内被扫码付款；
 *   - 查不到 / 查询异常 → 跳过本轮，不关单、不发告警轰炸。
 *
 * 只扫「挂起超过 N 分钟、未超过 24 小时」的 `payMode=live` 挂起单。
 * 补入账与关单的具体执行下沉到 `PlatformPaymentReconcileSettlementService`。
 *
 * 多实例部署下用 Redis 分布式锁保证同一时刻只有一个实例在跑。
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AlertService } from '../../shared/alert/alert.service';
import { PlatformWechatNativeService } from './platform-wechat-native.service';
import { PlatformPaymentReconcileSettlementService } from './platform-payment-reconcile-settlement.service';
import type { PendingPaymentOrder } from './platform-payment-reconcile-settlement.service';
import {
  PROFIT_PAYMENT_RECONCILE_DEFAULT_BATCH_SIZE,
  PROFIT_PAYMENT_RECONCILE_DEFAULT_MIN_PENDING_MINUTES,
  PROFIT_PAYMENT_RECONCILE_LOCK_KEY,
  PROFIT_PAYMENT_RECONCILE_LOCK_TTL_MS,
  PROFIT_PAYMENT_RECONCILE_MAX_PENDING_AGE_MS,
  PROFIT_PAYMENT_RECONCILE_MIN_QUERY_INTERVAL_SECONDS,
  PROFIT_PAYMENT_RECONCILE_THROTTLE_KEY_PREFIX,
} from './platform-payment-reconcile.constants';

/** 单轮对账结果，便于日志、告警与测试断言 */
export interface PlatformPaymentReconcileSummary {
  /** 本轮纳入核对的挂起单数 */
  scanned: number;
  /** 微信侧已支付、已完成补入账的单数 */
  settled: number;
  /** 确认未支付且已过本地有效期、已完成关单的单数 */
  closed: number;
  /** 核对过程出错（网络 / 微信异常）的单数；业务类型未接入只告警，不计入 */
  failed: number;
}

const EMPTY_SUMMARY: PlatformPaymentReconcileSummary = {
  scanned: 0,
  settled: 0,
  closed: 0,
  failed: 0,
};

@Injectable()
export class PlatformPaymentReconcileService {
  private readonly logger = new Logger(PlatformPaymentReconcileService.name);
  private running = false;
  private lockToken: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly alertService: AlertService,
    private readonly nativeService: PlatformWechatNativeService,
    private readonly settlementService: PlatformPaymentReconcileSettlementService,
  ) {}

  /**
   * 核对一轮挂起的平台支付单。
   *
   * 抢不到锁时直接返回空结果：多实例下其它实例正在跑，
   * 重复扫描只会把微信查单接口打爆。
   */
  async reconcile(): Promise<PlatformPaymentReconcileSummary> {
    if (this.running) {
      return EMPTY_SUMMARY;
    }

    let locked = false;
    try {
      locked = await this.acquireLock();
      if (!locked) {
        return EMPTY_SUMMARY;
      }
      this.running = true;

      const candidates = await this.findPendingCandidates();
      const summary: PlatformPaymentReconcileSummary = {
        scanned: candidates.length,
        settled: 0,
        closed: 0,
        failed: 0,
      };

      for (const order of candidates) {
        await this.reconcileOne(order, summary);
      }

      this.reportSummary(summary);
      return summary;
    } catch (error: unknown) {
      this.logger.error(
        `平台收款对账失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return EMPTY_SUMMARY;
    } finally {
      this.running = false;
      if (locked) await this.releaseLock();
    }
  }

  // ─── 候选扫描 ─────────────────────────────────────────────────────────────

  /** 扫出处于对账时间窗内的 live 挂起单，按创建时间升序（先老后新） */
  private async findPendingCandidates(): Promise<PendingPaymentOrder[]> {
    const now = Date.now();
    const minPendingMinutes = this.resolvePositiveInt(
      'app.platformPaymentReconcileMinPendingMinutes',
      PROFIT_PAYMENT_RECONCILE_DEFAULT_MIN_PENDING_MINUTES,
    );
    const batchSize = this.resolvePositiveInt(
      'app.platformPaymentReconcileBatchSize',
      PROFIT_PAYMENT_RECONCILE_DEFAULT_BATCH_SIZE,
    );

    return this.prisma.platformPaymentOrder.findMany({
      where: {
        status: 'pending',
        // 测试单在微信侧根本没有记录，查了也是白查
        payMode: 'live',
        // 太新的单不碰：用户可能正在付款，抢在回调之前查单没有收益
        createdAt: {
          gte: new Date(now - PROFIT_PAYMENT_RECONCILE_MAX_PENDING_AGE_MS),
          lte: new Date(now - minPendingMinutes * 60 * 1000),
        },
      },
      select: {
        orderNo: true,
        bizType: true,
        amountFen: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });
  }

  // ─── 单笔核对 ─────────────────────────────────────────────────────────────

  private async reconcileOne(
    order: PendingPaymentOrder,
    summary: PlatformPaymentReconcileSummary,
  ): Promise<void> {
    try {
      // 节流窗口内刚查过：本轮跳过，不重复打微信查单接口
      if (!(await this.acquireQuerySlot(order.orderNo))) {
        return;
      }

      const snapshot = await this.nativeService.queryNativeOrder(
        order.orderNo,
        order.bizType,
      );

      // 微信侧查不到该单：与「未支付」严格区分 —— 不关单、不刷告警
      if (!snapshot) {
        this.logger.warn(
          `[平台收款对账] ${order.orderNo} 微信侧查不到交易，本轮跳过`,
        );
        return;
      }

      if (snapshot.tradeState === 'SUCCESS') {
        const settled = await this.settlementService.settlePaidOrder(
          order,
          snapshot,
        );
        if (settled) {
          summary.settled += 1;
        }
        return;
      }

      if (
        this.settlementService.isUnpaid(snapshot.tradeState) &&
        this.settlementService.isExpired(order)
      ) {
        const closed = await this.settlementService.closeUnpaidOrder(order);
        if (closed) {
          summary.closed += 1;
        }
      }
    } catch (error: unknown) {
      summary.failed += 1;
      this.logger.error(
        `[平台收款对账] ${order.orderNo} 核对失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ─── 汇总告警 ─────────────────────────────────────────────────────────────

  /**
   * 只在「补了入账」或「核对出错」时告警：全部订单确认未支付属于正常情况，
   * 每个周期都发一条只会训练大家忽略告警。
   */
  private reportSummary(summary: PlatformPaymentReconcileSummary): void {
    if (summary.settled === 0 && summary.failed === 0) {
      return;
    }

    const level = summary.failed > 0 ? 'error' : 'warn';
    void this.alertService.send({
      level,
      title: '平台收款对账发现丢失的支付回调',
      content:
        `扫描=${summary.scanned} 补入账=${summary.settled} ` +
        `关单=${summary.closed} 核对失败=${summary.failed}。` +
        '补入账以微信查单结果为准；出现补入账说明有回调丢失，请排查 notify_url 可用性。',
      suppressKey: 'profit-payment-reconcile',
    });
  }

  // ─── 配置 ─────────────────────────────────────────────────────────────────

  /**
   * 读取正整数配置。
   *
   * 缺失 / 非法 / 非正值一律回落到兜底值：对账是后台兜底任务，
   * 环境变量写错不应该让定时任务崩掉。
   */
  private resolvePositiveInt(key: string, fallback: number): number {
    const raw = this.configService.get<number>(key);
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
      ? Math.floor(raw)
      : fallback;
  }

  // ─── 节流与分布式锁 ───────────────────────────────────────────────────────

  /** 抢占本次查单名额；false 表示节流窗口内已查过 */
  private async acquireQuerySlot(orderNo: string): Promise<boolean> {
    return this.redisService.setIfAbsent(
      `${PROFIT_PAYMENT_RECONCILE_THROTTLE_KEY_PREFIX}${orderNo}`,
      String(Date.now()),
      PROFIT_PAYMENT_RECONCILE_MIN_QUERY_INTERVAL_SECONDS,
    );
  }

  private async acquireLock(): Promise<boolean> {
    const token = randomUUID();
    const result = await this.redisService
      .getClient()
      .set(
        PROFIT_PAYMENT_RECONCILE_LOCK_KEY,
        token,
        'PX',
        PROFIT_PAYMENT_RECONCILE_LOCK_TTL_MS,
        'NX',
      );
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
        PROFIT_PAYMENT_RECONCILE_LOCK_KEY,
        this.lockToken,
      );
    this.lockToken = null;
  }
}
