/**
 * 充值订单超时关闭（E1 / E2 / E3）。
 *
 * 只翻本地状态是不够的：微信支付有效期与本地订单有效期不一致，
 * 本地标 expired 而微信侧仍可支付时，用户付款成功会出现
 * 「前端已放弃、钱照扣」的资金事故。因此顺序固定为：
 *
 *   1. 先关微信侧订单（closeOrder）；
 *   2. 关单成功 → 本地翻转 expired；
 *   3. 关单返回 ORDERPAID → 绝不关本地单，改为主动核对并补落账；
 *   4. 关单结果未知（网络异常 / 未预期错误码）→ 保持 pending 等下次重试。
 *
 * 多实例部署下用 Redis 锁保证同一时刻只有一个实例在扫。
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
import { ClubWechatTransactionService } from '../payments/club-wechat-transaction.service';
import { ClubRechargeWechatVerifyService } from './club-recharge-wechat-verify.service';

/** 分布式锁 key */
const LOCK_KEY = 'club:recharge:expiration:lock';
/** 锁 TTL 必须大于单轮扫描耗时上限，避免并发两轮 */
const LOCK_TTL_MS = 55_000;
/** 扫描周期 */
const SCAN_INTERVAL_MS = 60_000;
/** 单轮最多处理订单数：控制一轮内的微信关单调用量 */
const BATCH_SIZE = 100;

@Injectable()
export class ClubRechargeExpirationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ClubRechargeExpirationService.name);
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private lockToken: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly alertService: AlertService,
    private readonly transactionService: ClubWechatTransactionService,
    private readonly verifyService: ClubRechargeWechatVerifyService,
  ) {}

  onModuleInit(): void {
    this.interval = setInterval(
      () => void this.expireDueOrders(),
      SCAN_INTERVAL_MS,
    );
    this.interval.unref();
    void this.expireDueOrders();
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  /** 扫描并处理已过期的待支付订单 */
  async expireDueOrders(): Promise<void> {
    if (this.running) return;

    let locked = false;
    try {
      locked = await this.acquireLock();
      if (!locked) return;
      this.running = true;

      const dueOrders = await this.prisma.clubRechargeOrder.findMany({
        where: {
          status: 'pending',
          expiresAt: { lte: new Date() },
          deletedAt: null,
        },
        orderBy: { expiresAt: 'asc' },
        take: BATCH_SIZE,
        select: { orderNo: true, storeId: true },
      });

      for (const order of dueOrders) {
        await this.expireOneOrder(order.orderNo, order.storeId);
      }
    } catch (error: unknown) {
      this.logger.error(
        `扫描超时充值订单失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
      if (locked) await this.releaseLock();
    }
  }

  // ─── 单笔处理 ─────────────────────────────────────────────────────────────

  private async expireOneOrder(
    orderNo: string,
    storeId: number,
  ): Promise<void> {
    try {
      const closeResult = await this.transactionService.closeOrder({
        storeId,
        orderNo,
      });

      if (closeResult === 'paid') {
        // 微信侧已支付：本地绝不能关单，改为核对并补落账
        this.logger.warn(
          `充值订单 ${orderNo} 关单时发现微信侧已支付，转主动核对补落账`,
        );
        await this.verifyService.verifyAndSettle({ orderNo, force: true });
        return;
      }

      await this.markExpired(orderNo);
    } catch (error: unknown) {
      // 关单结果未知：保持 pending 等下次重试，禁止直接标 expired
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `关闭超时充值订单失败 orderNo=${orderNo} storeId=${storeId}，保持 pending 等待重试: ${reason}`,
      );
      await this.alertService.send({
        level: 'error',
        title: '充值订单超时关单失败',
        content: `orderNo=${orderNo} storeId=${storeId} 原因=${reason}，订单保持 pending，将在下个扫描周期重试`,
        suppressKey: `recharge-close-failed:${orderNo}`,
      });
    }
  }

  /** 本地翻转 expired；条件更新保证并发下只有一次生效 */
  private async markExpired(orderNo: string): Promise<void> {
    const updated = await this.prisma.clubRechargeOrder.updateMany({
      where: { orderNo, status: 'pending' },
      data: { status: 'expired' },
    });

    if (updated.count > 0) {
      this.logger.log(`充值订单 ${orderNo} 超时未支付，已关闭`);
    }
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
