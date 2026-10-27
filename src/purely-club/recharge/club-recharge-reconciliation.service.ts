/**
 * 充值订单日终对账（G3）。
 *
 * 解决的是「过了一个结算周期仍然没有人发现」的问题：
 * 回调丢失、队列死信没人处理、进程重启错过回调，这些情况下订单会长期停在
 * pending，而用户早已付款。仅靠实时链路（回调 + 主动查单）覆盖不到这类沉默故障。
 *
 * 对账口径刻意**不用下载微信账单**：
 *   - 本地 club_recharge_orders 已经覆盖全部充值订单，无需再从账单反推；
 *   - 微信查单接口（D3）本来就是权威事实源，逐笔核对比解析账单更直接，
 *     也不需要额外的账单下载权限与 CSV 解析口径维护。
 *
 * 只处理「跨天仍未决」的订单，避免与实时补偿重复：
 *   - 微信侧已支付 → 走 verifyAndSettle 补落账（金额不符等异常由该服务告警并拒绝落账）；
 *   - 微信侧未支付 → 交由超时关单任务（E1/E2）收口。
 *
 * 多实例部署下用 Redis 锁保证同一时刻只有一个实例在跑。
 */
import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AlertService } from '../../shared/alert/alert.service';
import { ClubRechargeWechatVerifyService } from './club-recharge-wechat-verify.service';

/** 分布式锁 key */
const LOCK_KEY = 'club:recharge:reconciliation:lock';
/** 锁 TTL：单轮核对的微信调用量有上限，5 分钟足够 */
const LOCK_TTL_MS = 5 * 60 * 1000;
/** 扫描周期：每小时一次；跨天订单数量少，重复扫描代价可接受且能兜住重启遗漏 */
const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
/** 单轮最多核对订单数：控制对微信查单接口的调用量 */
const BATCH_SIZE = 200;

/** 单轮对账结果，便于日志与测试断言 */
export interface RechargeReconciliationSummary {
  /** 本轮纳入核对的跨天未决订单数 */
  scanned: number;
  /** 核对后确认已支付并完成落账的订单数 */
  settled: number;
  /** 核对过程出错的订单数 */
  failed: number;
}

/** 今天 0 点：只核对早于今天的订单，避免与实时链路抢同一批 */
const resolveStartOfToday = (): Date => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
};

const EMPTY_SUMMARY: RechargeReconciliationSummary = {
  scanned: 0,
  settled: 0,
  failed: 0,
};

@Injectable()
export class ClubRechargeReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ClubRechargeReconciliationService.name);
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private lockToken: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly alertService: AlertService,
    private readonly verifyService: ClubRechargeWechatVerifyService,
  ) {}

  onModuleInit(): void {
    this.interval = setInterval(
      () => void this.reconcileStaleOrders(),
      RECONCILE_INTERVAL_MS,
    );
    this.interval.unref();
    // 启动即跑一轮：进程重启后不必等满一个周期才补上昨天漏掉的订单
    void this.reconcileStaleOrders();
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  /** 核对所有跨天仍未决的充值订单 */
  async reconcileStaleOrders(): Promise<RechargeReconciliationSummary> {
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

      const staleOrders = await this.prisma.clubRechargeOrder.findMany({
        where: {
          status: 'pending',
          createdAt: { lt: resolveStartOfToday() },
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        select: { orderNo: true },
      });

      const summary: RechargeReconciliationSummary = {
        scanned: staleOrders.length,
        settled: 0,
        failed: 0,
      };

      for (const order of staleOrders) {
        await this.reconcileOneOrder(order.orderNo, summary);
      }

      this.reportSummary(summary);
      return summary;
    } catch (error: unknown) {
      this.logger.error(
        `充值订单对账失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return EMPTY_SUMMARY;
    } finally {
      this.running = false;
      if (locked) await this.releaseLock();
    }
  }

  // ─── 单笔核对与汇报 ───────────────────────────────────────────────────────

  private async reconcileOneOrder(
    orderNo: string,
    summary: RechargeReconciliationSummary,
  ): Promise<void> {
    try {
      const result = await this.verifyService.verifyAndSettle({
        orderNo,
        force: true,
      });
      if (result.status === 'paid') {
        summary.settled += 1;
        this.logger.warn(`充值订单 ${orderNo} 对账发现已支付，已补落账`);
      }
    } catch (error: unknown) {
      summary.failed += 1;
      this.logger.error(
        `充值订单 ${orderNo} 对账失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 汇总告警。
   *
   * 只有「补了落账」或「核对出错」才需要惊动人：全部订单都确认未支付属于正常情况，
   * 每个小时都发一条只会训练大家忽略告警。
   */
  private reportSummary(summary: RechargeReconciliationSummary): void {
    if (summary.settled === 0 && summary.failed === 0) {
      return;
    }

    const level = summary.failed > 0 ? 'error' : 'warn';
    void this.alertService.send({
      level,
      title: '充值订单对账发现积压未决订单',
      content:
        `扫描=${summary.scanned} 补落账=${summary.settled} 核对失败=${summary.failed}。` +
        '补落账以微信查单结果为准；核对失败请按订单日志排查微信侧连通性。',
      suppressKey: 'club-recharge-reconciliation',
    });
  }

  // ─── 分布式锁 ─────────────────────────────────────────────────────────────

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
