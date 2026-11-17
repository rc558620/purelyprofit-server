import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import {
  ONLINE_TTL_SECONDS,
  PRINTERS_TTL_SECONDS,
  printAgentOnlineKey,
  printAgentPrintersKey,
} from './print-agent.types';
import type {
  PrintAgentConnection,
  PrintAgentOnlineMarker,
  PrintAgentPrinter,
  PrintAgentStatus,
  PrintAgentTask,
} from './print-agent.types';

/**
 * 打印代理在线注册表：维护「门店 → 在线连接」的内存映射，并把在线状态与
 * 打印机列表同步到 Redis，使 cluster 下未持有连接的 worker 也能正确判定。
 *
 * 拆出独立 provider 的原因：本类只关心连接生命周期与缓存读写，
 * 不参与绑定码、注册令牌与任务路由编排，职责边界清晰。
 */
@Injectable()
export class PrintAgentRegistryService {
  private readonly logger = new Logger('PrintAgentRegistry');
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

  constructor(private readonly redisService: RedisService) {}

  /** 本 worker 是否持有该门店的在线连接。 */
  hasConnection(storeId: number): boolean {
    return this.connections.has(storeId);
  }

  /** 记录代理最后在线时间（回执/心跳均刷新）。 */
  markSeen(storeId: number): void {
    this.lastSeenCache.set(storeId, Date.now());
  }

  /**
   * 向本 worker 持有的连接下发打印任务。
   * 无连接 / 连接已断开 / 发送抛错均返回 false 并清理失效连接，
   * 由调用方降级为「跨 worker 转发」或判定离线。
   */
  trySend(storeId: number, task: PrintAgentTask): boolean {
    const connection = this.connections.get(storeId);
    if (!connection) return false;
    if (connection.readyState !== 1) {
      this.connections.delete(storeId);
      return false;
    }
    try {
      connection.send(JSON.stringify({ type: 'print', ...task }));
      return true;
    } catch (error) {
      this.connections.delete(storeId);
      this.logger.warn(
        `打印任务本机下发失败: storeId=${storeId} taskId=${task.taskId} ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** 挂载代理连接（网关建立连接并校验令牌后调用）；同时写入 Redis 在线标记。 */
  async attach(
    storeId: number,
    connection: PrintAgentConnection,
  ): Promise<void> {
    this.connections.set(storeId, connection);
    this.markSeen(storeId);
    try {
      await this.markOnline(storeId);
    } catch (error) {
      // 在线标记写入失败不阻断挂载：本 worker 仍可直接下发（降级语义同 touch）
      this.warnDegraded('在线标记写入', storeId, error);
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
      await this.redisService.del(printAgentOnlineKey(storeId));
      await this.redisService.del(printAgentPrintersKey(storeId));
    } catch (error) {
      // 删除失败由在线标记/打印机缓存 TTL 自动过期兜底
      this.warnDegraded('在线标记删除', storeId, error);
    }
    this.logger.warn(`打印代理离线: storeId=${storeId} pid=${process.pid}`);
  }

  /** 记录代理最后在线时间 + 续期 Redis 在线标记（连接保持时周期调用）。 */
  async touch(storeId: number): Promise<void> {
    this.markSeen(storeId);
    try {
      // 每次心跳重写在线标记：TTL 续期 + Redis 恢复后自动重建（expire 无法重建已过期的 key）
      await this.markOnline(storeId);
    } catch (error) {
      // Redis 不可用时降级：本 worker 直接下发不依赖在线标记，仅跨 worker 转发受影响
      this.warnDegraded('在线标记续期', storeId, error);
    }
  }

  /**
   * 查询门店代理在线状态（商家端展示）。
   * - 本 worker 持有连接 → 直接在线，最后在线时间取本地内存
   * - 本 worker 无连接（cluster：代理连在其它 worker）→ 读 Redis 在线标记判定，
   *   并从标记里恢复最后在线时间，避免多 worker 部署时商家端误显示"离线"
   * - Redis 不可用 → 降级为本地判定（本 worker 无连接即按离线，与原 semantics 一致）
   */
  async getStatus(storeId: number): Promise<PrintAgentStatus> {
    const localLastSeenAt = this.lastSeenCache.get(storeId) ?? null;
    if (this.connections.has(storeId)) {
      return { online: true, lastSeenAt: localLastSeenAt };
    }
    try {
      const marker = await this.redisService.getJson<PrintAgentOnlineMarker>(
        printAgentOnlineKey(storeId),
      );
      // 离线时保留本 worker 观察到的最后在线时间（语义为"上次在线"，不应随离线清空）
      if (!marker) return { online: false, lastSeenAt: localLastSeenAt };
      return { online: true, lastSeenAt: marker.lastSeenAt ?? null };
    } catch (error) {
      // Redis 不可用时降级：与 touch/attach 同范式，连接关闭类错误静默等待重连
      this.warnDegraded('在线标记读取', storeId, error);
      return { online: false, lastSeenAt: localLastSeenAt };
    }
  }

  /**
   * 保存代理上报的可用打印机列表：写入本 worker 内存并异步同步到 Redis，
   * 使 cluster 下未持有连接的 worker（商家端随机落到的 worker）也能读到列表。
   * Redis 写入失败不阻断上报处理——内存态已生效，失败仅导致跨 worker 不可见。
   */
  setPrinters(storeId: number, printers: PrintAgentPrinter[]): void {
    this.printerCache.set(storeId, printers);
    void this.redisService
      .setJson(printAgentPrintersKey(storeId), printers, PRINTERS_TTL_SECONDS)
      .catch((error: unknown) => {
        this.warnDegraded('打印机列表缓存', storeId, error);
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
        printAgentPrintersKey(storeId),
      );
      return printers ?? [];
    } catch (error) {
      // Redis 不可用时降级为空列表（商家端退回本机探测），不阻断打印设备查询
      this.warnDegraded('打印机列表读取', storeId, error);
      return [];
    }
  }

  /**
   * 写入 Redis 在线标记（持有连接的 worker pid + 最后在线时间）；
   * attach 挂载与 touch 心跳共用——每次重写同时完成 TTL 续期，
   * 且 Redis 恢复后可自动重建标记（expire 无法复活已过期的 key）。
   */
  private async markOnline(storeId: number): Promise<void> {
    const marker: PrintAgentOnlineMarker = {
      pid: process.pid,
      lastSeenAt: Date.now(),
    };
    await this.redisService.setJson(
      printAgentOnlineKey(storeId),
      marker,
      ONLINE_TTL_SECONDS,
    );
  }

  /**
   * Redis 降级日志收敛：连接关闭类错误静默等待重连（与 cache-prewarm 同范式），
   * 其余错误记录 warn，避免同一段 catch 在各方法内重复出现。
   */
  private warnDegraded(action: string, storeId: number, error: unknown): void {
    if (this.redisService.isConnectionClosedError(error)) return;
    this.logger.warn(
      `打印代理${action}失败: storeId=${storeId} ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
