/**
 * 扫码点餐打印编排：读一次配置快照 → 通道校验 → 自动打印去重 → 分派云/USB → 记录任务状态。
 *
 * 把「路由决策」和「实际下发」分开，保证一次打印只读一份门店配置：
 * 旧实现里 controller 先读通道、service 再读 SN，两次读取之间配置变更会出现
 * 「按云通道路由却用旧 SN」的不一致窗口。
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ScanOrderingCloudPrintService } from './scan-ordering-cloud-print.service';
import type { CloudPrintTarget } from './scan-ordering-cloud-print.service';
import {
  ScanOrderingPrintSettingsService,
  type PrintChannel,
  type ScanOrderingPrintSettings,
} from './scan-ordering-print-settings.service';
import { ScanOrderingUsbPrintService } from './scan-ordering-usb-print.service';
import { ScanOrderingPrintTaskService } from './scan-ordering-print-task.service';
import type { ScanOrderingPrintTaskStatus } from './scan-ordering-print-task.service';
import { PrintAgentService } from './print-agent.service';
import type { ScanOrderingPrintSource } from './dto/scan-ordering-print-action.dto';

/**
 * 代理自动补打窗口：台账停在 submitted 说明代理已落盘等待补打，
 * 窗口内再创建新任务会与补打开出的票重复；超窗视为链路异常，放行人工补打。
 */
const RETRYING_BLOCK_MS = 10 * 60 * 1000;

/** 打印下发结果：前端据此区分「已下发 / 已打过（去重）/ 失败」。 */
export interface ScanOrderingPrintDispatchResult {
  /** 业务订单 ID。 */
  orderId: number;
  /** 打印目标。 */
  target: CloudPrintTarget;
  /** 上游任务标识（飞鹅订单 ID / 代理 taskId），无上游标识时回落本地任务 ID。 */
  taskId: string;
  /** 任务状态（pending 不会出现在返回值里）。 */
  status: ScanOrderingPrintTaskStatus;
  /** 自动打印命中已有任务时为 true（本次未重复下发）。 */
  deduped: boolean;
  /** 失败/结果未知时的原因。 */
  error: string | null;
}

/** 打印任务状态查询结果。 */
export interface ScanOrderingPrintTaskStatusResult {
  /** 打印目标。 */
  target: CloudPrintTarget;
  /** 任务状态；无记录时返回 null。 */
  status: ScanOrderingPrintTaskStatus | null;
  /** 上游任务标识。 */
  taskId: string | null;
  /** 失败/结果未知时的原因。 */
  error: string | null;
  /** 最近更新时间（毫秒时间戳）；无记录为 null。 */
  updatedAt: number | null;
}

@Injectable()
export class ScanOrderingPrintDispatchService {
  private readonly logger = new Logger(ScanOrderingPrintDispatchService.name);

  constructor(
    private readonly commerceAccessService: CommerceAccessService,
    private readonly printSettingsService: ScanOrderingPrintSettingsService,
    private readonly printTaskService: ScanOrderingPrintTaskService,
    private readonly cloudPrintService: ScanOrderingCloudPrintService,
    private readonly usbPrintService: ScanOrderingUsbPrintService,
    private readonly printAgentService: PrintAgentService,
  ) {}

  /** 正式出票：按门店配置快照分派到云打印或 USB 打印。 */
  async printOrder(
    user: AuthenticatedUser,
    input: {
      target: CloudPrintTarget;
      orderId: number;
      source: ScanOrderingPrintSource;
    },
  ): Promise<ScanOrderingPrintDispatchResult> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const channel = this.pickChannel(settings, input.target);
    this.assertBackendChannel(channel);

    const taskKey = { storeId, orderId: input.orderId, target: input.target };
    let taskId: string;
    if (input.source === 'auto') {
      const gate = await this.printTaskService.beginAuto(taskKey);
      if (!gate.acquired) {
        // 已下发/结果未知：不重复出票，把真实状态回给前端
        return {
          orderId: input.orderId,
          target: input.target,
          taskId: gate.state.upstreamId ?? gate.state.taskId,
          status: gate.state.status,
          deduped: true,
          error: gate.state.error,
        };
      }
      // beginAuto 已在原子脚本内写入 pending（含任务 ID 与短租约），无需再写一次
      taskId = gate.state.taskId;
    } else {
      // 代理仍在自动补打时不允许创建新任务：旧任务补打成功会与新任务重复出票
      await this.assertNoRetryingTask(storeId, input);
      // 人工补打写独立桶：不去重，也不覆盖自动打印的去重记录
      // （否则补打失败会把已成功的自动任务写成 failed，下一条自动事件又出一张票）
      taskId = this.newLocalTaskId();
      await this.printTaskService.markPending(taskKey, 'manual', taskId);
    }

    try {
      const upstreamId = await this.dispatchSnapshot({
        storeId,
        settings,
        channel,
        target: input.target,
        orderId: input.orderId,
        operatorName: user.name ?? undefined,
      });
      await this.printTaskService.markDispatched(
        taskKey,
        input.source,
        taskId,
        upstreamId,
      );
      return {
        orderId: input.orderId,
        target: input.target,
        taskId: upstreamId,
        status: 'dispatched',
        deduped: false,
        error: null,
      };
    } catch (error) {
      const message = this.errorMessage(error);
      if (this.isDefiniteFailure(error, channel)) {
        // 明确未送达：保留失败原因，自动打印下次可重试
        await this.printTaskService.markFailed(
          taskKey,
          input.source,
          taskId,
          message,
        );
      } else {
        // 已发出但结果未知（如云打印超时）：短窗口内不自动重试
        await this.printTaskService.markUnknown(
          taskKey,
          input.source,
          taskId,
          message,
        );
      }
      throw error;
    }
  }

  /** 试打：只使用已保存配置，不参与自动打印去重。 */
  async testPrint(
    user: AuthenticatedUser,
    target: CloudPrintTarget,
  ): Promise<{ taskId: string }> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const channel = this.pickChannel(settings, target);
    this.assertBackendChannel(channel);
    const taskId =
      channel === 'usb'
        ? await this.usbPrintService.testPrintForMerchant(user, target)
        : await this.cloudPrintService.testPrintForMerchant(user, target);
    return { taskId };
  }

  /**
   * 查询订单级打印状态：按本次任务标识对账代理回执。
   *
   * Redis 记录只是「已提交」视图，真实出纸结果在代理台账里。只用 Redis 会遮住
   * 后来的失败回执（提交成功但代理没出纸），所以有 taskId 时一律回台账核对。
   */
  async getTaskStatus(
    user: AuthenticatedUser,
    input: { orderId: number; target: CloudPrintTarget; taskId?: string },
  ): Promise<ScanOrderingPrintTaskStatusResult> {
    const storeId = await this.resolveMerchantStoreId(user);
    if (input.taskId) {
      // 按本次下发的任务 ID 精确核对：只可能有这一张票的回执，不读同订单其它票
      return this.getTaskStatusByIdempotencyKey(storeId, input);
    }
    const state = await this.printTaskService.getLatestState({
      storeId,
      orderId: input.orderId,
      target: input.target,
    });
    if (state) {
      const taskIdInUse = state.upstreamId ?? state.taskId;
      const receipt = await this.printAgentService.findTaskById(
        storeId,
        taskIdInUse,
        {
          domain: 'scan',
          saleOrderId: input.orderId,
          target: input.target,
        },
      );
      if (receipt) {
        return {
          target: input.target,
          status: this.mapReceiptStatus(receipt.status),
          taskId: receipt.taskId,
          error: receipt.error,
          updatedAt: state.updatedAt,
        };
      }
      return {
        target: input.target,
        status: state.status,
        taskId: taskIdInUse,
        error: state.error,
        updatedAt: state.updatedAt,
      };
    }
    // 无 Redis 视图（例如此前由其它实例直接下发）时，按业务域 + 票种回退台账
    const receipt = await this.printAgentService.findLatestTask(storeId, {
      domain: 'scan',
      saleOrderId: input.orderId,
      target: input.target,
    });
    if (!receipt) {
      return {
        target: input.target,
        status: null,
        taskId: null,
        error: null,
        updatedAt: null,
      };
    }
    return {
      target: input.target,
      status: this.mapReceiptStatus(receipt.status),
      taskId: receipt.taskId,
      error: receipt.error,
      updatedAt: null,
    };
  }

  /** 按通道分派到对应下发实现。 */
  private dispatchSnapshot(input: {
    storeId: number;
    settings: ScanOrderingPrintSettings;
    channel: PrintChannel;
    target: CloudPrintTarget;
    orderId: number;
    operatorName?: string;
  }): Promise<string> {
    const { channel, ...rest } = input;
    return channel === 'usb'
      ? this.usbPrintService.printSnapshot(rest)
      : this.cloudPrintService.printSnapshot(rest);
  }

  private pickChannel(
    settings: ScanOrderingPrintSettings,
    target: CloudPrintTarget,
  ): PrintChannel {
    return target === 'kitchen'
      ? settings.kitchenPrintChannel
      : settings.cashierPrintChannel;
  }

  /** browser/off 不由后端下发：显式拒绝，避免回落到云打印。 */
  private assertBackendChannel(channel: PrintChannel): void {
    if (channel === 'cloud' || channel === 'usb') return;
    throw new BadRequestException(
      '当前打印通道未启用云/USB 打印，请先在打印设置中选择云打印或 USB 打印',
    );
  }

  /** 人工补打前置：代理正在自动补打（台账 submitted 且在窗口内）时拒绝新任务。 */
  private async assertNoRetryingTask(
    storeId: number,
    input: { orderId: number; target: CloudPrintTarget },
  ): Promise<void> {
    const latest = await this.printAgentService.findLatestTask(storeId, {
      domain: 'scan',
      saleOrderId: input.orderId,
      target: input.target,
    });
    // createdAt 缺失（历史行/异常回执）时不拦截：宁可让商家补打，也不要把入口锁死
    const createdAt =
      latest?.createdAt instanceof Date ? latest.createdAt.getTime() : 0;
    if (
      latest?.status === 'submitted' &&
      Date.now() - createdAt <= RETRYING_BLOCK_MS
    ) {
      throw new ConflictException(
        '该订单打印任务仍在重试中，请稍后确认出纸结果',
      );
    }
  }

  /**
   * 按本次任务 ID 查状态：先查代理台账（真实回执），再核对 Redis 是否就是这次任务。
   * 云打印没有代理台账，返回 null 状态（前端按「已提交、无回执」处理），
   * 不能用「该订单最近一条」代替，否则会把另一张票的结果算到这张上。
   */
  private async getTaskStatusByIdempotencyKey(
    storeId: number,
    input: { orderId: number; target: CloudPrintTarget; taskId?: string },
  ): Promise<ScanOrderingPrintTaskStatusResult> {
    const taskId = input.taskId ?? '';
    const receipt = await this.printAgentService.findTaskById(storeId, taskId, {
      domain: 'scan',
      saleOrderId: input.orderId,
      target: input.target,
    });
    if (receipt) {
      return {
        target: input.target,
        status: this.mapReceiptStatus(receipt.status),
        taskId: receipt.taskId,
        error: receipt.error,
        updatedAt: null,
      };
    }
    const state = await this.printTaskService.getLatestState({
      storeId,
      orderId: input.orderId,
      target: input.target,
    });
    if (!state || (state.taskId !== taskId && state.upstreamId !== taskId)) {
      return {
        target: input.target,
        status: null,
        taskId,
        error: null,
        updatedAt: null,
      };
    }
    return {
      target: input.target,
      status: state.status,
      taskId,
      error: state.error,
      updatedAt: state.updatedAt,
    };
  }

  /**
   * 代理台账状态 → 对外任务状态。
   *
   * printed=代理已出纸 → dispatched；failed=代理执行失败 → failed；
   * submitted=已提交待回执 → submitted。三者不能合并：把 submitted 判成 failed
   * 会让商家以为没打出来而重复补打。
   */
  private mapReceiptStatus(status: string): ScanOrderingPrintTaskStatus {
    if (status === 'printed') return 'dispatched';
    if (status === 'failed') return 'failed';
    return 'submitted';
  }

  /**
   * 明确未送达的判定：
   * - 参数/资源类异常（未配置 SN、订单不存在）一定没发出去；
   * - USB 通道失败（代理离线/本机设备写失败）也没有进入打印；
   * - 云通道的 503 可能是超时或 HTTP 失败，重新下发会重复出票，按「结果未知」处理。
   */
  private isDefiniteFailure(error: unknown, channel: PrintChannel): boolean {
    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      return true;
    }
    return channel === 'usb';
  }

  private errorMessage(error: unknown): string {
    const loggerMessage =
      error instanceof Error ? error.message : String(error);
    this.logger.warn(`打印下发失败: ${loggerMessage}`);
    return loggerMessage;
  }

  private newLocalTaskId(): string {
    return randomUUID();
  }

  private async resolveMerchantStoreId(
    user: AuthenticatedUser,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权操作扫码点餐打印',
    );
  }
}
