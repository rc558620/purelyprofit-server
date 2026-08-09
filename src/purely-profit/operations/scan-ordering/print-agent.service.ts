import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import type { PrintAgentRegisterResult } from './dto/scan-ordering-print-agent.dto';

/** 打印代理在线连接：原生 WebSocket 的轻量抽象，由网关注册时挂载。 */
export interface PrintAgentConnection {
  /** 连接是否可发送（readyState === OPEN）。 */
  readonly readyState: number;
  /** 发送 JSON 文本到代理。 */
  send(data: string): void;
  /** 关闭连接。 */
  close(code?: number, reason?: string): void;
}

/** 打印任务下发结果。 */
export type PrintAgentDispatchResult =
  | { ok: true; taskId: string; forwarded?: boolean }
  | { ok: false; reason: 'agent-offline' | 'no-agent'; message: string };

/** 打印代理回执。 */
export interface PrintAgentReceipt {
  taskId: string;
  ok: boolean;
  error?: string | null;
}

/** 打印代理下发的 ESC/POS 任务。 */
export interface PrintAgentTask {
  taskId: string;
  target: 'cashier' | 'kitchen';
  /** 完整 ESC/POS 字节流的 Base64 编码。 */
  dataBase64: string;
}

/** 代理上报的可用打印机信息。 */
export interface PrintAgentPrinter {
  id: string;
  name: string;
  type: 'device' | 'cups' | 'windows';
}

/** 任务转发消息（跨 worker 广播）。 */
interface PrintAgentForwardMessage {
  storeId: number;
  task: PrintAgentTask;
}

/** Redis 频道：打印任务跨 worker 转发。 */
const PRINT_AGENT_CHANNEL = 'purelyprofit:print-agent:task:v1';
/** Redis key 前缀：门店代理在线标记（值为持有连接的 worker pid）。 */
const PRINT_AGENT_ONLINE_PREFIX = 'purelyprofit:print-agent:online:';
/** 在线标记 TTL（秒）：需大于心跳间隔，worker 崩溃后自动过期兜底。 */
const ONLINE_TTL_SECONDS = 90;
/** 心跳间隔（秒），与网关 ping 间隔保持一致。 */
const HEARTBEAT_INTERVAL_SECONDS = 30;

/**
 * 扫码点餐打印代理服务：
 * - 生成门店绑定码（商家端展示给客户）
 * - 代理注册：绑定码 → 代理令牌
 * - 维护门店 → 在线代理连接的映射，向在线代理推送打印任务
 * - Cluster 兼容：本 worker 无连接时通过 Redis Pub/Sub 转发给持有连接的 worker；
 *   在线标记（Redis key + TTL）用于判断代理是否全局离线
 * - 接收代理打印回执并更新最后在线时间
 */
@Injectable()
export class PrintAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PrintAgentService');
  /** storeId → 在线代理连接（同一门店一般只装一个代理，后连覆盖先连）。 */
  private readonly connections = new Map<number, PrintAgentConnection>();
  /** storeId → 最近一次回执时间（毫秒时间戳）。 */
  private readonly lastSeenCache = new Map<number, number>();
  /** storeId → 代理上报的可用打印机列表。 */
  private readonly printerCache = new Map<number, PrintAgentPrinter[]>();
  private unsubscribeRedis: (() => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
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
    const bindCode = this.randomBindCode();
    await this.prisma.store.update({
      where: { id: storeId },
      data: { printAgentBindCode: bindCode },
    });
    this.logger.log(`生成打印代理绑定码: storeId=${storeId}`);
    return bindCode;
  }

  /** 读取门店当前绑定码（未生成时返回 null）。 */
  async getBindCode(storeId: number): Promise<string | null> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { printAgentBindCode: true },
    });
    return store?.printAgentBindCode ?? null;
  }

  /** 打印代理注册：绑定码 → 代理令牌。 */
  async register(
    bindCode: string,
    platform?: string,
    version?: string,
  ): Promise<PrintAgentRegisterResult> {
    const store = await this.prisma.store.findFirst({
      where: { printAgentBindCode: bindCode },
      select: { id: true },
    });
    if (!store) {
      throw new BadRequestException('绑定码无效，请检查后重新输入');
    }
    const token = randomBytes(32).toString('hex');
    await this.prisma.store.update({
      where: { id: store.id },
      data: { printAgentToken: token },
    });
    this.logger.log(
      `打印代理注册成功: storeId=${store.id} platform=${platform ?? '-'} version=${version ?? '-'}`,
    );
    return { token, storeId: store.id };
  }

  /** 查询门店是否已绑定代理（本地部署未绑定时走服务器本机打印）。 */
  async isAgentBound(storeId: number): Promise<boolean> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { printAgentToken: true },
    });
    return Boolean(store?.printAgentToken);
  }

  /** 查询门店代理在线状态（商家端展示；cluster 下合并 Redis 在线标记）。 */
  getAgentStatus(storeId: number): {
    online: boolean;
    lastSeenAt: number | null;
  } {
    // 本 worker 持有连接即在线；否则等待 Redis 在线标记确认（异步由 refresh 补全）
    return {
      online: this.connections.has(storeId),
      lastSeenAt: this.lastSeenCache.get(storeId) ?? null,
    };
  }

  /** 保存代理上报的可用打印机列表。 */
  setPrinters(storeId: number, printers: PrintAgentPrinter[]): void {
    this.printerCache.set(storeId, printers);
  }

  /** 读取代理上报的可用打印机列表（未上报时返回空数组）。 */
  getPrinters(storeId: number): PrintAgentPrinter[] {
    return this.printerCache.get(storeId) ?? [];
  }

  /** 挂载代理连接（网关建立连接并校验令牌后调用）；同时写入 Redis 在线标记。 */
  async attach(
    storeId: number,
    connection: PrintAgentConnection,
  ): Promise<void> {
    this.connections.set(storeId, connection);
    this.lastSeenCache.set(storeId, Date.now());
    try {
      await this.markOnline(storeId);
    } catch (error) {
      // 在线标记写入失败不阻断挂载：本 worker 仍可直接下发（降级语义同 touch）
      if (!this.redisService.isConnectionClosedError(error)) {
        this.logger.warn(
          `打印代理在线标记写入失败: storeId=${storeId} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.logger.log(`打印代理在线: storeId=${storeId} pid=${process.pid}`);
  }

  /** 移除代理连接；删除 Redis 在线标记（代理离线兜底由 TTL 处理）。 */
  async detach(
    storeId: number,
    connection: PrintAgentConnection,
  ): Promise<void> {
    if (this.connections.get(storeId) !== connection) return;
    this.connections.delete(storeId);
    try {
      await this.redisService.del(this.onlineKey(storeId));
    } catch (error) {
      // 删除失败由在线标记 TTL 自动过期兜底
      if (!this.redisService.isConnectionClosedError(error)) {
        this.logger.warn(
          `打印代理在线标记删除失败: storeId=${storeId} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.logger.warn(`打印代理离线: storeId=${storeId} pid=${process.pid}`);
  }

  /** 记录代理最后在线时间 + 续期 Redis 在线标记（连接保持时周期调用）。 */
  async touch(storeId: number): Promise<void> {
    this.lastSeenCache.set(storeId, Date.now());
    try {
      // 每次心跳重写在线标记：TTL 续期 + Redis 恢复后自动重建（expire 无法重建已过期的 key）
      await this.markOnline(storeId);
    } catch (error) {
      // Redis 不可用时降级：本 worker 直接下发不依赖在线标记，仅跨 worker 转发受影响；
      // 与 cache-prewarm 同范式：连接关闭类错误静默等待重连，其余记录 warn
      if (!this.redisService.isConnectionClosedError(error)) {
        this.logger.warn(
          `打印代理在线标记续期失败: storeId=${storeId} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
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
    const connection = this.connections.get(storeId);
    if (connection) {
      if (connection.readyState !== 1) {
        this.connections.delete(storeId);
        return this.dispatchViaRedis(storeId, task);
      }
      try {
        connection.send(JSON.stringify({ type: 'print', ...task }));
        return { ok: true, taskId: task.taskId };
      } catch {
        this.connections.delete(storeId);
        return this.dispatchViaRedis(storeId, task);
      }
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
      const online = await this.redisService.exists(this.onlineKey(storeId));
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
      const connection = this.connections.get(parsed.storeId);
      if (!connection) return; // 连接不在本 worker，忽略（发送方已确认存在在线标记）
      if (connection.readyState !== 1) {
        this.connections.delete(parsed.storeId);
        return;
      }
      connection.send(JSON.stringify({ type: 'print', ...parsed.task }));
      this.lastSeenCache.set(parsed.storeId, Date.now());
      this.logger.log(
        `打印任务转发已下发: storeId=${parsed.storeId} taskId=${parsed.task.taskId} pid=${process.pid}`,
      );
    } catch (error) {
      this.logger.error(
        `处理打印代理转发任务失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 写入 Redis 在线标记（值为持有连接的 worker pid）；attach 挂载与 touch 心跳共用。 */
  private async markOnline(storeId: number): Promise<void> {
    await this.redisService.set(
      this.onlineKey(storeId),
      String(process.pid),
      ONLINE_TTL_SECONDS,
    );
  }

  /** 门店在线标记 Redis key。 */
  private onlineKey(storeId: number): string {
    return `${PRINT_AGENT_ONLINE_PREFIX}${storeId}`;
  }

  /** 生成 6 位大写字母数字绑定码（去掉易混淆字符 0/O/1/I）。 */
  private randomBindCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[randomInt(alphabet.length)];
    }
    return code;
  }
}

export { HEARTBEAT_INTERVAL_SECONDS, ONLINE_TTL_SECONDS };
