import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { RedisService } from '../../../redis/redis.service';
import { PrintAgentBindingService } from './print-agent-binding.service';
import { PrintAgentRegistryService } from './print-agent-registry.service';
import { PRINT_AGENT_CHANNEL, printAgentOnlineKey } from './print-agent.types';
import type {
  PrintAgentConnection,
  PrintAgentDispatchResult,
  PrintAgentForwardMessage,
  PrintAgentPrinter,
  PrintAgentTask,
} from './print-agent.types';
import type { PrintAgentRegisterResult } from './dto/scan-ordering-print-agent.dto';

/** 兼容既有引用方：协议类型仍从本模块导出。 */
export type {
  PrintAgentConnection,
  PrintAgentDispatchResult,
  PrintAgentOnlineMarker,
  PrintAgentPrinter,
  PrintAgentReceipt,
  PrintAgentStatus,
  PrintAgentTask,
} from './print-agent.types';

export {
  HEARTBEAT_INTERVAL_SECONDS,
  ONLINE_TTL_SECONDS,
} from './print-agent.types';

/**
 * 扫码点餐打印代理服务（编排层）：
 * - 代理注册与绑定码：委托 {@link PrintAgentBindingService}
 * - 连接生命周期、在线标记与打印机缓存：委托 {@link PrintAgentRegistryService}
 * - 本服务只保留任务路由：本 worker 直发 / Cluster 下经 Redis Pub/Sub 转发，
 *   并向商家端暴露统一的打印代理门面接口
 * - 在线标记（Redis key + TTL）用于判断代理是否全局离线
 */
@Injectable()
export class PrintAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PrintAgentService');
  private unsubscribeRedis: (() => Promise<void>) | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly registry: PrintAgentRegistryService,
    private readonly binding: PrintAgentBindingService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribeRedis = await this.redisService.subscribe(
      PRINT_AGENT_CHANNEL,
      (message) => this.handleForwardedTask(message),
    );
    this.logger.log(`打印代理任务转发订阅已建立，pid=${process.pid}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribeRedis?.();
    this.unsubscribeRedis = null;
  }

  /** 商家端生成/重置门店绑定码。 */
  async generateBindCode(storeId: number): Promise<string> {
    return this.binding.generateBindCode(storeId);
  }

  /** 读取门店当前绑定码（未生成时返回 null）。 */
  async getBindCode(storeId: number): Promise<string | null> {
    return this.binding.getBindCode(storeId);
  }

  /** 打印代理注册：绑定码 → 代理令牌；携带 deviceId 时按门店+设备独立登记（多台电脑互不覆盖）。 */
  async register(
    bindCode: string,
    deviceId?: string,
    platform?: string,
    version?: string,
  ): Promise<PrintAgentRegisterResult> {
    return this.binding.register(bindCode, deviceId, platform, version);
  }

  /** 查询门店是否已绑定代理（本地部署未绑定时走服务器本机打印）。 */
  async isAgentBound(storeId: number): Promise<boolean> {
    return this.binding.isBound(storeId);
  }

  /** 查询门店代理在线状态（商家端展示，cluster 下跨 worker 判定）。 */
  async getAgentStatus(
    storeId: number,
  ): Promise<{ online: boolean; lastSeenAt: number | null }> {
    return this.registry.getStatus(storeId);
  }

  /** 查询门店最近一次注册代理的版本号（用于商家端新旧版本对比提示）。 */
  async getLatestRegisteredVersion(storeId: number): Promise<string | null> {
    return this.binding.getLatestRegisteredVersion(storeId);
  }

  /** 保存代理上报的可用打印机列表（本 worker 内存 + Redis 跨 worker 共享）。 */
  setPrinters(storeId: number, printers: PrintAgentPrinter[]): void {
    this.registry.setPrinters(storeId, printers);
  }

  /** 读取代理上报的可用打印机列表（未上报时返回空数组）。 */
  async getPrinters(storeId: number): Promise<PrintAgentPrinter[]> {
    return this.registry.getPrinters(storeId);
  }

  /** 挂载代理连接（网关建立连接并校验令牌后调用）。 */
  async attach(
    storeId: number,
    connection: PrintAgentConnection,
  ): Promise<void> {
    await this.registry.attach(storeId, connection);
  }

  /** 移除代理连接并清理在线标记与打印机列表。 */
  async detach(
    storeId: number,
    connection: PrintAgentConnection,
  ): Promise<void> {
    await this.registry.detach(storeId, connection);
  }

  /** 记录代理最后在线时间 + 续期 Redis 在线标记（连接保持时周期调用）。 */
  async touch(storeId: number): Promise<void> {
    await this.registry.touch(storeId);
  }

  /**
   * 向门店在线代理下发打印任务。
   * - 本 worker 持有连接 → 直接下发
   * - 本 worker 无连接但 Redis 在线标记存在（代理在另一 worker）→ 通过 Redis Pub/Sub 转发
   * - 在线标记不存在 → 代理全局离线
   */
  async dispatch(
    storeId: number,
    task: PrintAgentTask,
  ): Promise<PrintAgentDispatchResult> {
    if (this.registry.trySend(storeId, task)) {
      return { ok: true, taskId: task.taskId };
    }
    return this.dispatchViaRedis(storeId, task);
  }

  /** 生成唯一任务 ID。 */
  static newTaskId(): string {
    return randomBytes(12).toString('hex');
  }

  /** 本 worker 无连接时：先查 Redis 在线标记，再决定转发或判定离线。 */
  private async dispatchViaRedis(
    storeId: number,
    task: PrintAgentTask,
  ): Promise<PrintAgentDispatchResult> {
    try {
      const online = await this.redisService.exists(
        printAgentOnlineKey(storeId),
      );
      if (!online) {
        return {
          ok: false,
          reason: 'agent-offline',
          message: '门店打印代理未在线，请确认代理程序已打开并连接成功',
        };
      }
      const message: PrintAgentForwardMessage = { storeId, task };
      await this.redisService.publish(
        PRINT_AGENT_CHANNEL,
        JSON.stringify(message),
      );
      this.logger.log(
        `打印任务跨 worker 转发: storeId=${storeId} taskId=${task.taskId} pid=${process.pid}`,
      );
      return { ok: true, taskId: task.taskId, forwarded: true };
    } catch (error) {
      return {
        ok: false,
        reason: 'agent-offline',
        message: `打印代理下发失败：${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  /** 处理跨 worker 转发的打印任务：本 worker 持有连接则下发。 */
  private handleForwardedTask(message: string): void {
    try {
      const parsed = JSON.parse(message) as PrintAgentForwardMessage;
      // 连接不在本 worker 或已失效时忽略（发送方已确认存在在线标记）
      if (!this.registry.trySend(parsed.storeId, parsed.task)) return;
      this.registry.markSeen(parsed.storeId);
      this.logger.log(
        `打印任务转发已下发: storeId=${parsed.storeId} taskId=${parsed.task.taskId} pid=${process.pid}`,
      );
    } catch (error) {
      this.logger.error(
        `处理打印代理转发任务失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
