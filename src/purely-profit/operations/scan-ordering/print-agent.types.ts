/**
 * 扫码点餐打印代理的协议类型、Redis 键约定与时间常量。
 *
 * 从 `print-agent.service.ts` 抽出：协议契约属于跨端（Go 代理 / 网关 / 商家端）
 * 的稳定约定，与 service 内部编排逻辑无耦合，单独成文便于同步演进。
 */

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
 * 值为结构化 JSON 而非纯 pid，便于跨 worker 恢复最后在线时间。
 */
export interface PrintAgentOnlineMarker {
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
  /**
   * 门店选中的打印机设备 ID（来自代理上报的 printers 列表）。
   * 旧版代理会忽略该字段并回退到按 target 解析；新版代理按此精确选择。
   */
  deviceId?: string;
  /** 完整 ESC/POS 字节流的 Base64 编码。 */
  dataBase64: string;
}

/** 代理上报的可用打印机信息。 */
export interface PrintAgentPrinter {
  id: string;
  name: string;
  type: 'device' | 'cups' | 'windows';
}

/** 门店代理在线状态（商家端展示）。 */
export interface PrintAgentStatus {
  online: boolean;
  lastSeenAt: number | null;
}

/** 任务转发消息（跨 worker 广播）。 */
export interface PrintAgentForwardMessage {
  storeId: number;
  task: PrintAgentTask;
}

/** Redis 频道：打印任务跨 worker 转发。 */
export const PRINT_AGENT_CHANNEL = 'purelyprofit:print-agent:task:v1';
/** Redis key 前缀：门店代理在线标记（值为持有连接的 worker pid + 最后在线时间）。 */
const PRINT_AGENT_ONLINE_PREFIX = 'purelyprofit:print-agent:online:';
/** Redis key 前缀：门店代理上报的打印机列表（跨 worker 共享，避免占有着连接的 worker 才能取到）。 */
const PRINT_AGENT_PRINTERS_PREFIX = 'purelyprofit:print-agent:printers:';
/** 在线标记 TTL（秒）：需大于心跳间隔，worker 崩溃后自动过期兜底。 */
export const ONLINE_TTL_SECONDS = 90;
/** 打印机列表 TTL（秒）：代理每次上报都会刷新；代理异常退出未触发 detach 时由 TTL 回收。 */
export const PRINTERS_TTL_SECONDS = 24 * 60 * 60;
/** 心跳间隔（秒），与网关 ping 间隔保持一致。 */
export const HEARTBEAT_INTERVAL_SECONDS = 30;

/** 门店在线标记 Redis key。 */
export const printAgentOnlineKey = (storeId: number): string =>
  `${PRINT_AGENT_ONLINE_PREFIX}${storeId}`;

/** 门店代理打印机列表 Redis key。 */
export const printAgentPrintersKey = (storeId: number): string =>
  `${PRINT_AGENT_PRINTERS_PREFIX}${storeId}`;
