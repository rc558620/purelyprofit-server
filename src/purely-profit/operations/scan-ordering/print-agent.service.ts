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

/**
 * Redis 在线标记内容（cluster 下供非持有连接的 worker 判定代理在线状态）。
 * 仅本服务读写，值为结构化 JSON 而非纯 pid，便于跨 worker 恢复最后在线时间。
 */
interface PrintAgentOnlineMarker {
  /** 持有该连接的 worker 进程 ID（排障用）。 */
  pid: number;
  /** 最近一次心跳/挂载时间戳（毫秒）。 */
  lastSeenAt: number;
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
  /** 打印目标：cashier=收银台顾客票 / kitchen=后厨制作单 / space=空间消费小票。 */
  target: 'cashier' | 'kitchen' | 'space';
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
/** Redis key 前缀：门店代理在线标记（值为持有连接的 worker pid + 最后在线时间）。 */
const PRINT_AGENT_ONLINE_PREFIX = 'purelyprofit:print-agent:online:';
/** Redis key 前缀：门店代理上报的打印机列表（跨 worker 共享，避免占有着连接的 worker 才能取到）。 */
const PRINT_AGENT_PRINTERS_PREFIX = 'purelyprofit:print-agent:printers:';
/** 在线标记 TTL（秒）：需大于心跳间隔，worker 崩溃后自动过期兜底。 */
const ONLINE_TTL_SECONDS = 90;
/** 打印机列表 TTL（秒）：代理每次上报都会刷新；代理异常退出未触发 detach 时由 TTL 回收。 */
const PRINTERS_TTL_SECONDS = 24 * 60 * 60;
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
  /**
   * storeId → 在线代理连接。
   *
   * 已知限制（与 register 的多设备概念并存）：虽然同一门店可按 deviceId 注册多台电脑
   * （各自持有独立 token 互不覆盖），但 WebSocket 连接按门店单例保存——后连会覆盖先连，
   * 打印任务只发给最后连上的那台机器。要让多台电脑各自分担打印目标（收银台/后厨），
   * 需要按 deviceId 维护连接并在任务里带上目标机器路由，属于协议层改造。
   */
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

  /** 打印代理注册：绑定码 → 代理令牌；携带 deviceId 时按门店+设备独立登记（多台电脑互不覆盖）。 */
  async register(
    bindCode: string,
    deviceId?: string,
    platform?: string,
    version?: string,
  ): Promise<PrintAgentRegisterResult> {
    const store = await this.prisma.store.findFirst({
      where: { printAgentBindCode: bindCode },
      select: { id: true, name: true },
    });
    if (!store) {
      throw new BadRequestException('绑定码无效，请检查后重新输入');
    }
    const token = randomBytes(32).toString('hex');
    if (deviceId) {
      // 多代理：同一门店多台电脑各持有独立 token，互不覆盖
      await this.prisma.printAgent.upsert({
        where: { storeId_deviceId: { storeId: store.id, deviceId } },
        create: { storeId: store.id, deviceId, token, platform, version },
        update: { token, platform, version },
      });
    } else {
      // 旧代理兼容：未上报 deviceId 时沿用门店单 token 逻辑
      await this.prisma.store.update({
        where: { id: store.id },
        data: { printAgentToken: token },
      });
    }
    this.logger.log(
      `打印代理注册成功: storeId=${store.id} deviceId=${deviceId ?? '-'} platform=${platform ?? '-'} version=${version ?? '-'}`,
    );
    return { token, storeId: store.id, storeName: store.name };
  }

  /** 查询门店是否已绑定代理（本地部署未绑定时走服务器本机打印）。
   *  多代理：存在任一设备登记或旧版单 token 即视为已绑定。 */
  async isAgentBound(storeId: number): Promise<boolean> {
    const [agent, store] = await Promise.all([
      this.prisma.printAgent.findFirst({
        where: { storeId },
        select: { id: true },
      }),
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: { printAgentToken: true },
      }),
    ]);
    return Boolean(agent) || Boolean(store?.printAgentToken);
  }

  /**
   * 查询门店代理在线状态（商家端展示）。
   * - 本 worker 持有连接 → 直接在线，最后在线时间取本地内存
   * - 本 worker 无连接（cluster：代理连在其它 worker）→ 读 Redis 在线标记判定，
   *   并从标记里恢复最后在线时间，避免多 worker 部署时商家端误显示"离线"
   * - Redis 不可用 → 降级为本地判定（本 worker 无连接即按离线，与原 semantics 一致）
   */
  async getAgentStatus(storeId: number): Promise<{
    online: boolean;
    lastSeenAt: number | null;
  }> {
    if (this.connections.has(storeId)) {
      return {
        online: true,
        lastSeenAt: this.lastSeenCache.get(storeId) ?? null,
      };
    }
    try {
      const marker = await this.redisService.getJson<PrintAgentOnlineMarker>(
        this.onlineKey(storeId),
      );
      if (!marker) {
        // 离线时保留本 worker 观察到的最后在线时间（语义为"上次在线"，不应随离线清空）
        return {
          online: false,
          lastSeenAt: this.lastSeenCache.get(storeId) ?? null,
        };
      }
      return {
        online: true,
        lastSeenAt: marker.lastSeenAt ?? null,
      };
    } catch (error) {
      // Redis 不可用时降级：与 touch/attach 同范式，连接关闭类错误静默等待重连
      if (!this.redisService.isConnectionClosedError(error)) {
        this.logger.warn(
          `打印代理在线标记读取失败: storeId=${storeId} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return {
        online: false,
        lastSeenAt: this.lastSeenCache.get(storeId) ?? null,
      };
    }
  }

  /** 查询门店最近一次注册代理的版本号（用于商家端新旧版本对比提示）。 */
  async getLatestRegisteredVersion(storeId: number): Promise<string | null> {
    const agent = await this.prisma.printAgent.findFirst({
      where: { storeId, version: { not: null } },
      orderBy: { updatedAt: 'desc' },
      select: { version: true },
    });
    return agent?.version ?? null;
  }

  /**
   * 保存代理上报的可用打印机列表：写入本 worker 内存并异步同步到 Redis，
   * 使 cluster 下未持有连接的 worker（商家端随机落到的 worker）也能读到列表。
   * Redis 写入失败不阻断上报处理——内存态已生效，失败仅导致跨 worker 不可见。
   */
  setPrinters(storeId: number, printers: PrintAgentPrinter[]): void {
    this.printerCache.set(storeId, printers);
    void this.redisService
      .setJson(this.printersKey(storeId), printers, PRINTERS_TTL_SECONDS)
      .catch((error: unknown) => {
        if (!this.redisService.isConnectionClosedError(error)) {
          this.logger.warn(
            `打印代理打印机列表缓存失败: storeId=${storeId} ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
  }

  /**
   * 读取代理上报的可用打印机列表（未上报时返回空数组）。
   * 本 worker 内存优先，缺失时回退 Redis（代理连在其它 worker 的场景）。
   */
  async getPrinters(storeId: number): Promise<PrintAgentPrinter[]> {
    const cached = this.printerCache.get(storeId);
    if (cached) return cached;
    try {
      const printers = await this.redisService.getJson<PrintAgentPrinter[]>(
        this.printersKey(storeId),
      );
      return printers ?? [];
    } catch (error) {
      // Redis 不可用时降级为空列表（商家端退回本机探测），不阻断打印设备查询
      if (!this.redisService.isConnectionClosedError(error)) {
        this.logger.warn(
          `打印代理打印机列表读取失败: storeId=${storeId} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return [];
    }
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
    // 离线即清空上报的打印机列表：代理断开后不应继续展示/选择门店打印机
    this.printerCache.delete(storeId);
    try {
      await this.redisService.del(this.onlineKey(storeId));
      await this.redisService.del(this.printersKey(storeId));
    } catch (error) {
      // 删除失败由在线标记/打印机缓存 TTL 自动过期兜底
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

  /**
   * 写入 Redis 在线标记（持有连接的 worker pid + 最后在线时间）；
   * attach 挂载与 touch 心跳共用——每次重写同时完成 TTL 续期，
   * 且 Redis 恢复后可自动重建标记（expire 无法复活已过期的 key）。
   */
  private async markOnline(storeId: number): Promise<void> {
    const now = Date.now();
    const marker: PrintAgentOnlineMarker = {
      pid: process.pid,
      lastSeenAt: now,
    };
    await this.redisService.setJson(
      this.onlineKey(storeId),
      marker,
      ONLINE_TTL_SECONDS,
    );
  }

  /** 门店在线标记 Redis key。 */
  private onlineKey(storeId: number): string {
    return `${PRINT_AGENT_ONLINE_PREFIX}${storeId}`;
  }

  /** 门店代理打印机列表 Redis key。 */
  private printersKey(storeId: number): string {
    return `${PRINT_AGENT_PRINTERS_PREFIX}${storeId}`;
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
