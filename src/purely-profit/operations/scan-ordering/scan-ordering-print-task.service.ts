/**
 * 扫码点餐打印任务状态（Redis 视图）。
 *
 * 去重与「是否已打印」是两件事，这里用任务记录同时表达，但按来源分桶存放：
 * - auto 桶：自动打印的抢占记录与去重依据，永不被人工补打覆盖
 * - manual 桶：人工补打最近一次尝试，仅用于状态查询
 * 两个桶分开存放解决了「一次成功的自动任务被人工补打写成 failed，下一条自动事件
 * 又重新出票」的重复出票问题。
 *
 * 状态语义：
 * - pending：已占位但尚未提交给打印机（下发前的中间态，使用短租约）
 * - dispatched：已提交给云打印/代理（是否出纸看回执）
 * - failed：明确未送达（未配置 SN、代理离线、飞鹅明确拒绝），允许自动打印重试
 * - unknown：已发出但结果未知（超时/网络中断），不做自动重试，避免重复出票
 * - submitted：仅由代理台账回执推导（已提交、等回执），不写入任务记录
 *
 * 抢占与终态写入都走 Lua 原子脚本：`get` 后 `set` 会让两个终端同时读到 failed，
 * 各自写 pending 并双双下发，导致同一张票重复出纸。
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from '../../../redis/redis.service';
import type { CloudPrintTarget } from './scan-ordering-cloud-print.service';
import type { ScanOrderingPrintSource } from './dto/scan-ordering-print-action.dto';

/** 打印任务状态：待提交 / 已提交待回执 / 已提交 / 明确失败 / 结果未知。 */
export type ScanOrderingPrintTaskStatus =
  | 'pending'
  | 'submitted'
  | 'dispatched'
  | 'failed'
  | 'unknown';

/** 单条打印任务状态快照。 */
export interface ScanOrderingPrintTaskState {
  /** 本地任务 ID（云打印为飞鹅订单 ID 时记录在 upstreamId）。 */
  taskId: string;
  /** 任务状态。 */
  status: ScanOrderingPrintTaskStatus;
  /** 触发来源：auto 参与去重，manual 为人工补打。 */
  source: ScanOrderingPrintSource;
  /** 上游任务标识（飞鹅订单 ID / 代理 taskId）。 */
  upstreamId: string | null;
  /** 失败或结果未知的原因。 */
  error: string | null;
  /** 最近一次状态更新时间（毫秒时间戳）。 */
  updatedAt: number;
}

/** 任务标识：门店 + 订单 + 打印目标（来源决定落到哪个桶）。 */
export interface ScanOrderingPrintTaskKey {
  storeId: number;
  orderId: number;
  target: CloudPrintTarget;
}

/** 自动打印名额抢占结果：acquired=false 表示已有终端处理过该订单。 */
export interface AutoDispatchGate {
  acquired: boolean;
  state: ScanOrderingPrintTaskState;
}

/** 已成功打出的任务保留 7 天，覆盖同一天的重复事件与多终端并发。 */
const TASK_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 结果未知的任务只保留短窗口：期间不自动重试，避免重复出票。 */
const UNKNOWN_TASK_TTL_SECONDS = 10 * 60;

/**
 * pending 短租约：进程在下发途中崩溃时不能让订单被拦 7 天（漏票），
 * 超过租约即视为「没人在处理」，允许下一次自动事件重新抢占。
 */
const PENDING_LEASE_SECONDS = 60;

const TASK_KEY_PREFIX = 'scanordering:print-task:';

/**
 * 抢占自动打印名额：仅当记录不存在或上次明确失败时写入 pending。
 * Lua 内完成「读状态 → 判断 → 写」，并发终端只有一个能拿到名额。
 */
const ACQUIRE_AUTO_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if raw then
  local ok, state = pcall(cjson.decode, raw)
  if not ok or type(state) ~= 'table' or state['status'] ~= 'failed' then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`;

/**
 * 终态写入：只有「当前记录仍属于本次尝试」时才覆盖。
 * 上次尝试因租约过期被新一轮接管后，迟到的结果不得覆盖新一轮的 pending。
 */
const WRITE_IF_OWNER_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if raw then
  local ok, state = pcall(cjson.decode, raw)
  if ok and type(state) == 'table' and type(state['taskId']) == 'string'
     and state['taskId'] ~= '' and state['taskId'] ~= ARGV[2] then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
return 1
`;

function buildTaskKey(
  input: ScanOrderingPrintTaskKey,
  source: ScanOrderingPrintSource,
): string {
  return `${TASK_KEY_PREFIX}${input.storeId}:${input.orderId}:${input.target}:${source}`;
}

@Injectable()
export class ScanOrderingPrintTaskService {
  private readonly logger = new Logger(ScanOrderingPrintTaskService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * 抢占一次自动打印名额。
   *
   * Redis 故障时放行（宁可重复打印也不漏打），并返回内存态任务，避免主流程中断。
   */
  async beginAuto(input: ScanOrderingPrintTaskKey): Promise<AutoDispatchGate> {
    const key = buildTaskKey(input, 'auto');
    const pending = this.createState('auto', 'pending');
    try {
      const acquired = await this.acquireAutoSlot(key, pending);
      if (acquired) return { acquired: true, state: pending };
      const current = await this.readState(key);
      return {
        acquired: false,
        state: current ?? this.createState('auto', 'dispatched'),
      };
    } catch (error) {
      this.logger.warn(
        `自动打印去重不可用，按未打印处理: key=${key} reason=${this.errorMessage(error)}`,
      );
      return { acquired: true, state: pending };
    }
  }

  /** 记录任务进入下发流程（人工补打使用；自动打印由 beginAuto 原子写入）。 */
  async markPending(
    input: ScanOrderingPrintTaskKey,
    source: ScanOrderingPrintSource,
    taskId: string,
  ): Promise<void> {
    await this.writeState(
      buildTaskKey(input, source),
      { ...this.createState(source, 'pending'), taskId },
      TASK_TTL_SECONDS,
    );
  }

  /** 记录已提交给打印机（云打印/代理均视为已提交，不代表已出纸）。 */
  async markDispatched(
    input: ScanOrderingPrintTaskKey,
    source: ScanOrderingPrintSource,
    taskId: string,
    upstreamId: string,
  ): Promise<void> {
    await this.writeOwnedState(
      buildTaskKey(input, source),
      {
        ...this.createState(source, 'dispatched'),
        taskId,
        upstreamId: upstreamId || null,
      },
      taskId,
      TASK_TTL_SECONDS,
    );
  }

  /** 记录明确失败：保留状态供查询，但下次自动打印可重试。 */
  async markFailed(
    input: ScanOrderingPrintTaskKey,
    source: ScanOrderingPrintSource,
    taskId: string,
    reason: string,
  ): Promise<void> {
    await this.writeOwnedState(
      buildTaskKey(input, source),
      { ...this.createState(source, 'failed'), taskId, error: reason },
      taskId,
      TASK_TTL_SECONDS,
    );
  }

  /** 记录结果未知（超时/网络中断）：短窗口内不自动重试，避免重复出票。 */
  async markUnknown(
    input: ScanOrderingPrintTaskKey,
    source: ScanOrderingPrintSource,
    taskId: string,
    reason: string,
  ): Promise<void> {
    await this.writeOwnedState(
      buildTaskKey(input, source),
      { ...this.createState(source, 'unknown'), taskId, error: reason },
      taskId,
      UNKNOWN_TASK_TTL_SECONDS,
    );
  }

  /** 读取指定来源的任务状态。 */
  async getState(
    input: ScanOrderingPrintTaskKey,
    source: ScanOrderingPrintSource,
  ): Promise<ScanOrderingPrintTaskState | null> {
    return this.readState(buildTaskKey(input, source));
  }

  /**
   * 读取该订单+票种最近一次任务状态：aut/manual 两个桶取更新时间较新的一条。
   * 人工补打与自动打印各自成记录后，状态查询不能再只看其中一个桶。
   */
  async getLatestState(
    input: ScanOrderingPrintTaskKey,
  ): Promise<ScanOrderingPrintTaskState | null> {
    const [autoState, manualState] = await Promise.all([
      this.getState(input, 'auto'),
      this.getState(input, 'manual'),
    ]);
    if (!autoState) return manualState;
    if (!manualState) return autoState;
    return manualState.updatedAt > autoState.updatedAt
      ? manualState
      : autoState;
  }

  private async acquireAutoSlot(
    key: string,
    state: ScanOrderingPrintTaskState,
  ): Promise<boolean> {
    const result = await this.redisService.evalScript(
      ACQUIRE_AUTO_SCRIPT,
      [key],
      [JSON.stringify(state), String(PENDING_LEASE_SECONDS * 1000)],
    );
    return result === 1;
  }

  private async readState(
    key: string,
  ): Promise<ScanOrderingPrintTaskState | null> {
    try {
      const raw = await this.redisService.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ScanOrderingPrintTaskState>;
      if (!parsed || typeof parsed.status !== 'string') return null;
      return {
        taskId: parsed.taskId ?? '',
        status: parsed.status as ScanOrderingPrintTaskStatus,
        source: parsed.source === 'auto' ? 'auto' : 'manual',
        upstreamId: parsed.upstreamId ?? null,
        error: parsed.error ?? null,
        updatedAt: parsed.updatedAt ?? 0,
      };
    } catch (error) {
      this.logger.warn(
        `读取打印任务状态失败 key=${key} reason=${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  private createState(
    source: ScanOrderingPrintSource,
    status: ScanOrderingPrintTaskStatus,
  ): ScanOrderingPrintTaskState {
    return {
      taskId: randomUUID(),
      status,
      source,
      upstreamId: null,
      error: null,
      updatedAt: Date.now(),
    };
  }

  /** 无条件写入（人工补打占位；自动打印走原子抢占）。 */
  private async writeState(
    key: string,
    state: ScanOrderingPrintTaskState,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redisService.set(key, JSON.stringify(state), ttlSeconds);
    } catch (error) {
      // 状态写入失败只影响可观测性与去重，不阻断打印主流程
      this.logger.warn(
        `写入打印任务状态失败 key=${key} reason=${this.errorMessage(error)}`,
      );
    }
  }

  /** 仅当记录仍属于本次尝试时写入终态（taskId 条件更新）。 */
  private async writeOwnedState(
    key: string,
    state: ScanOrderingPrintTaskState,
    taskId: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redisService.evalScript(
        WRITE_IF_OWNER_SCRIPT,
        [key],
        [
          JSON.stringify(state),
          taskId,
          String(Math.max(1, Math.round(ttlSeconds)) * 1000),
        ],
      );
    } catch (error) {
      this.logger.warn(
        `写入打印任务终态失败 key=${key} reason=${this.errorMessage(error)}`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
