import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { SpacePrintSettingsService } from './space-print-settings.service';
import type { SpacePrintChannel } from './space-print-settings.service';
import {
  RECENT_SETTLED_ORDER_DEFAULT_LIMIT,
  SpacePrintDataService,
} from './space-print-data.service';
import type {
  SpacePrintOrder,
  SpaceRecentSettledOrder,
} from './space-print-data.service';
import { FeiePrintService } from '../scan-ordering/feie-print.service';
import { UsbPrintService } from '../scan-ordering/usb-print.service';
import { PrintAgentService } from '../scan-ordering/print-agent.service';
import { EscPosTicketBuilder } from '../scan-ordering/escpos-ticket.builder';
import type { SpaceEscPosTicket } from '../scan-ordering/escpos-ticket.builder';
import type { UsbPrinterInfo } from '../scan-ordering/usb-print.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 补打去重窗口：30 秒内同一订单视为重复提交，直接复用已有任务。 */
const REPRINT_DEDUPE_WINDOW_MS = 30_000;

/**
 * 提交占位租约：下发前先原子占位，避免「查不到已有任务 → 两个请求同时下发」。
 * 与补打去重窗口对齐；下发明确失败时主动释放，允许立即重试。
 */
const SUBMIT_LOCK_TTL_SECONDS = 30;

/** 空间小票的业务票种：代理端 target 统一落 cashier（Go 代理只区分 kitchen）。 */
const SPACE_PRINT_TARGET = 'cashier';

/**
 * 下发结果回带的实际通道：只有 usb 通道会产生代理台账与回执，
 * 前端必须据此决定是否轮询 task-status —— 云打印回执在飞鹅侧，
 * 轮询本地台账只会白跑固定次数后返回「请确认出纸」。
 */
/** 代理台账「最近一条任务」：闸门判定只需要这几个字段。 */
type SpaceLatestPrintTask = NonNullable<
  Awaited<ReturnType<PrintAgentService['findLatestTask']>>
>;

export interface SpacePrintSubmitResult {
  orderId: string;
  channel: SpacePrintChannel;
}

/** 补打结果：status=submitted 已下发 / printed 代理已出纸 / failed 失败。 */
export interface SpacePrintReprintResult extends SpacePrintSubmitResult {
  status: string;
}

/**
 * 销售记录补打结果：通道由后端一次决定，前端不得回退到其他通道。
 * - browser：只回权威快照，前端渲染 80mm 小票后调用浏览器打印，不下发设备
 * - cloud / usb：已下发（submitted），是否出纸以回执/人工确认为准
 * - off：门店已关闭空间小票打印，前端提示去设置里开启
 */
export interface SpaceSalesReceiptResult {
  channel: SpacePrintChannel;
  /**
   * snapshot=浏览器快照 / submitted=已下发 / printed=去重窗口内命中已出票任务（未重复下发）
   * / off=门店已关闭打印。
   */
  status: 'snapshot' | 'submitted' | 'printed' | 'off';
  /** 设备任务 ID（云打印=飞鹅订单号；USB 本机=提交回执）；browser/off 为 null。 */
  orderId: string | null;
  /** USB 代理任务 ID（用于按本次任务查回执）；仅代理下发时有值。 */
  taskId: string | null;
  /** browser 通道的权威小票快照；其余通道为 null（低权限端拿不到设备配置）。 */
  snapshot: SpacePrintOrder | null;
}

/** 内部下发结果：额外回带 USB 代理 taskId，用于「只核对本次任务」的回执查询。 */
interface SpacePrintDispatchResult {
  orderId: string;
  channel: 'cloud' | 'usb';
  taskId: string | null;
}

/** 去重 + 占位后的提交结果（补打与销售记录补打共用）。 */
interface SpacePrintSubmitOutcome {
  orderId: string;
  /** 命中「去重复用」时回带当前配置通道（可能为 browser/off，便于前端提示）。 */
  channel: SpacePrintChannel;
  /** USB 代理任务 ID；仅代理下发时有值。 */
  taskId: string | null;
  status: string;
}

export type { SpaceRecentSettledOrder } from './space-print-data.service';

/**
 * 代理自动补打窗口：台账停在 submitted 说明代理已落盘等待补打，
 * 窗口内再创建新任务会与自动补打开出的票重复；超窗视为链路异常，放行人工补打。
 *
 * 必须 ≥ 代理端 `printRetryMaxAgeMin`：代理超龄即丢弃任务并回执 failed，
 * 台账落定后这里自然放行；若本窗口短于代理有效期，就会出现「人工已补打、
 * 代理随后又把旧任务补出来」的双份票。
 *
 * 代理侧已把有效期硬钳在 `config.MaxRetryMaxAgeMin`（9 分钟，见 print-agent），
 * 配置写多大都超不过它，因此这里的 10 分钟恒大于代理有效期。改任一侧都必须同步另一侧。
 */
const REPRINT_AUTO_RETRY_BLOCK_MS = 10 * 60 * 1000;

/** 提交占位键：门店 + 业务订单（空间小票同一订单并发提交只允许一个穿过）。 */
const buildSubmitLockKey = (storeId: number, saleOrderId: number): string =>
  `spaces:print-submit:${storeId}:${saleOrderId}`;

/**
 * 持有者释放：只有锁上仍是本次请求写入的令牌才删除。
 * 否则旧请求的失败回调会把新一轮请求的锁删掉，等于没锁。
 * 下发成功后锁值会被换成 taskId，此时 ARGV[1] 传 taskId 即为「按任务释放」。
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * 把订单级占位升级为任务级占位：锁值由请求令牌换成 taskId（保留剩余租约）。
 * 之后只有持有该 taskId 的一方才能释放锁，无法按订单盲删别人正在用的锁。
 *
 * ttl <= 0 时直接放弃绑定：PTTL 返回 0 表示租约已到期（键毫秒内消失）、-1 表示键没有过期时间。
 * 此时若补写一次不带 PX 的 SET，会把「快过期的锁」变成永久锁（PTTL=-1），
 * 后续这张票即使打印成功，补打也会一直 409，只能人工删 key。
 * 放弃绑定最坏只是锁值仍是请求令牌、补打要等租约自然到期，不会留下永久锁。
 */
const BIND_LOCK_TASK_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then
  return 0
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ttl)
return 1
`;

/**
 * 空间消费小票下发服务（复用扫码点餐的打印通道基础设施）：
 * - cloud：读门店空间小票配置取云打印机 SN，组装飞鹅内容下发
 * - usb：组装 ESC/POS 字节流，已绑定打印代理则推送到门店代理，否则回退服务器本机 USB
 * 与扫码点餐打印完全隔离：各自独立的通道配置、内容组装与打印目标。
 */
@Injectable()
export class SpacePrintService {
  private readonly logger = new Logger(SpacePrintService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly printSettingsService: SpacePrintSettingsService,
    private readonly printDataService: SpacePrintDataService,
    private readonly feiePrintService: FeiePrintService,
    private readonly usbPrintService: UsbPrintService,
    private readonly agentService: PrintAgentService,
    private readonly ticketBuilder: EscPosTicketBuilder,
  ) {}

  /** 商家端下发空间消费小票打印任务（按门店配置通道分派 cloud/usb）。 */
  async printForMerchant(
    user: AuthenticatedUser,
    saleOrderId: number,
  ): Promise<SpacePrintSubmitResult> {
    const storeId = await this.resolveMerchantStoreId(user);
    // 一次读取配置并在整条链路内复用：避免出票期间改配置导致「选通道用旧值、
    // 取 SN/设备用新值」的混用，也省掉 cloud/usb 分支里的重复查询。
    const settings = await this.printSettingsService.getByStoreId(storeId);
    // 结账首打也必须过闸门：占位锁只活 30 秒，代理在自动补打时锁早过期，
    // 首打接口被重放（网络重试 / 停留在旧标签页 / 手工调接口）就会出第二张。
    await this.assertNoInflightTicket(storeId, saleOrderId);
    const { orderId, channel } = await this.dispatchOrder(
      storeId,
      saleOrderId,
      settings,
      // 结账当场打印：原结账操作员缺失时才回退到发起人姓名（历史行为）
      user.name ?? null,
    );
    return { orderId, channel };
  }

  /**
   * 补打：按销售订单重新下发小票。
   * 同一订单在去重窗口内已有「已提交/已打印」任务时直接返回该任务，
   * 避免收银员连点造成重复出纸（失败任务不拦截，允许立即重试）。
   */
  async reprintForMerchant(
    user: AuthenticatedUser,
    saleOrderId: number,
  ): Promise<SpacePrintReprintResult> {
    const storeId = await this.resolveMerchantStoreId(user);
    // 先校验订单属于当前门店：跨店 saleOrderId 在这里直接 404
    await this.printDataService.loadOrder(storeId, saleOrderId);
    // 一次读取配置并在整条链路内复用（通道、设备、下发同源）
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const outcome = await this.submitWithDedupe(storeId, saleOrderId, settings);
    return {
      orderId: outcome.orderId,
      status: outcome.status,
      channel: outcome.channel,
    };
  }

  /**
   * 销售记录补打：由后端按当前门店配置一次决定通道，前端不回退。
   *
   * 权限：当前门店同时具备 sales:view、space:view、operation-entry:create。
   * 注意 `RequirePermissions` 多项是 OR，这里在服务层逐项校验实现 AND，
   * 不要求 sales:delete，也不把只能查看销售记录的子账号升级成能出票。
   */
  async printSalesReceiptForMerchant(
    user: AuthenticatedUser,
    saleOrderId: number,
  ): Promise<SpaceSalesReceiptResult> {
    const storeId = await this.resolveSalesReceiptStoreId(user);
    // 一次读取配置：本次请求内选通道、取设备、下发全部复用同一份
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const channel = settings.spacePrintChannel;
    if (channel === 'off') {
      // 明确关闭：不调设备、不弹浏览器打印、不回退其他通道
      return {
        channel,
        status: 'off',
        orderId: null,
        taskId: null,
        snapshot: null,
      };
    }
    // 先校验订单可补打（跨店 / 不存在 / 未结账 / 已退款在这里就被拒，
    // 任何拒绝都不会读设备配置、更不会触发下发）
    const snapshot = await this.printDataService.loadSalesReceiptOrder(
      storeId,
      saleOrderId,
    );
    if (channel === 'browser') {
      // 浏览器通道不下发设备，但「同一订单仍可能出纸」的两条路径都要拦：
      // 1) 台账停在 submitted：代理已落盘、正在自动补打；
      // 2) 设备请求（cloud/usb）正在下发或即将下发。
      // 第 2 条不能只查一次锁：设备请求可能已经读完通道、还没抢锁，
      // 浏览器查空后设备再抢锁成功 → 两边都出票。因此浏览器也必须
      // 原子占用同一把出票占位（SET NX），与设备路径真正竞争同一资源。
      await this.assertNoInflightTicket(storeId, saleOrderId);
      await this.acquireSubmitSlot(storeId, saleOrderId, 'browser');
      // 占位不主动释放：它要覆盖「前端弹打印框 → 出纸」这段窗口，
      // 期间设备路径抢锁会 409，租约到期后自然恢复可重试。
      return {
        channel,
        status: 'snapshot',
        orderId: null,
        taskId: null,
        snapshot,
      };
    }
    const outcome = await this.submitWithDedupe(storeId, saleOrderId, settings);
    return {
      channel: outcome.channel,
      // 去重窗口内命中「已出票」的任务时不能再说已提交：前端据此提示无需重复打印
      status: outcome.status === 'printed' ? 'printed' : 'submitted',
      orderId: outcome.orderId,
      taskId: outcome.taskId,
      snapshot: null,
    };
  }

  /**
   * 「上一张仍可能出纸」闸门：三个下发入口（结账首打 / 会话补打 / 销售记录补打）
   * 共用，与当前通道无关。
   *
   * 台账只记录 USB/代理任务，因此这里挡的是「上一张 USB 票还没落定」的情况：
   * 占位锁只活 30 秒，切通道或锁过期后若不查台账，同一张票会再发一份。
   * submitted 且未超窗 → 拒绝；failed / printed / 超窗 → 放行（超窗视为链路异常，
   * 代理长期离线时不能永久堵住人工补打）。
   *
   * @returns 最近一条任务，供调用方复用（如按 taskId 释放失败任务的锁）
   */
  private async assertNoInflightTicket(
    storeId: number,
    saleOrderId: number,
  ): Promise<SpaceLatestPrintTask | null> {
    const latest = await this.agentService.findLatestTask(storeId, {
      domain: 'space',
      saleOrderId,
      target: SPACE_PRINT_TARGET,
    });
    if (
      latest?.status === 'submitted' &&
      Date.now() - latest.createdAt.getTime() <= REPRINT_AUTO_RETRY_BLOCK_MS
    ) {
      throw new ConflictException(
        '该订单上一张小票仍在打印中，请稍后确认出纸结果',
      );
    }
    return latest;
  }

  /**
   * 补打去重 + 并发占位（结账打印与销售记录补打共用，撞在一起也不会重复出票）。
   * 失败任务不拦截，允许立即重试；仍可能自动重试的 submitted 任务拒绝再发。
   */
  private async submitWithDedupe(
    storeId: number,
    saleOrderId: number,
    settings: Awaited<ReturnType<SpacePrintSettingsService['getByStoreId']>>,
  ): Promise<SpacePrintSubmitOutcome> {
    const channel = settings.spacePrintChannel;
    // 代理台账只记录 USB/代理任务：命中台账只可能是历史 USB 任务。
    // 因此「去重复用」只在当前通道也是 usb 时才成立——否则改成云打印后
    // 会直接复用旧 USB 任务、根本没下发云，却仍回「已提交」。
    if (channel === 'usb') {
      const recent = await this.agentService.findRecentActiveTask(storeId, {
        domain: 'space',
        saleOrderId,
        target: SPACE_PRINT_TARGET,
        withinMs: REPRINT_DEDUPE_WINDOW_MS,
      });
      if (recent) {
        // 回带台账真实通道与真实状态：printed 时前端提示「刚刚已打印」，
        // 不能再对一条已出票的旧任务说「已提交、请确认出纸」。
        return {
          orderId: recent.taskId,
          status: recent.status,
          channel: 'usb',
          taskId: recent.taskId,
        };
      }
    }
    // 与当前通道无关：本单上一次下发若仍可能出纸（代理在自动补打、台账停在
    // submitted），任何通道都不能再发。判定收敛在 assertNoInflightTicket，
    // 结账首打与浏览器补打走同一个口子，避免只堵住其中一条。
    const latest = await this.assertNoInflightTicket(storeId, saleOrderId);
    // 只有「这张票已被代理判定最终失败」才允许提前释放它占用的锁：
    // 按 taskId 做 compare-and-delete，锁值已被另一终端换成新任务时不会误删。
    // 不按订单无条件删锁——那会让两个终端同时补打各自删掉对方的锁（双双重复下发），
    // 也会让云打印超时（结果未知、锁必须保留）后的立即补打绕过锁再次下发。
    if (channel === 'usb' && latest?.status === 'failed') {
      await this.releaseSubmitSlot(storeId, saleOrderId, latest.taskId);
    }
    const dispatched = await this.dispatchOrder(
      storeId,
      saleOrderId,
      settings,
      // 补打不得用补打人覆盖原收银员：只有落库快照缺失时留空
      null,
    );
    // 只有代理下发才会拿到本地任务 ID：云打印与服务器本机 USB 都没有代理台账，
    // 拿飞鹅订单号/本机回执去查台账必然查不到，查询异常还会把「已受理」打成失败。
    if (!dispatched.taskId) {
      return { ...dispatched, status: 'submitted' };
    }
    // 跟踪本次任务而不是只回「已提交」：USB 代理秒级回执能直接带回真实出纸结果。
    // 回执查询本身失败不能让「已下发」变成「失败」——前端据此提示重试补打，
    // 收银员会再打一张，而设备那边第一张其实已经出纸。
    try {
      const receipt = await this.agentService.findTaskById(
        storeId,
        dispatched.taskId,
        { domain: 'space', saleOrderId, target: SPACE_PRINT_TARGET },
      );
      return {
        ...dispatched,
        status: receipt?.status ?? 'submitted',
      };
    } catch (error) {
      this.logger.warn(
        `[space-print] 回执查询失败，按已提交处理 storeId=${storeId} saleOrderId=${saleOrderId} taskId=${dispatched.taskId} reason=${error instanceof Error ? error.name : 'UnknownError'}`,
      );
      return { ...dispatched, status: 'submitted' };
    }
  }

  /**
   * 按门店通道下发（cloud / usb），内部完成并发占位、任务绑定与失败释放。
   * operatorFallback 只影响 USB 票面「操作员」缺失时的兜底，补打传 null。
   */
  private async dispatchOrder(
    storeId: number,
    saleOrderId: number,
    settings: Awaited<ReturnType<SpacePrintSettingsService['getByStoreId']>>,
    operatorFallback: string | null,
  ): Promise<SpacePrintDispatchResult> {
    const channel = settings.spacePrintChannel;
    if (channel !== 'cloud' && channel !== 'usb') {
      throw new BadRequestException(
        '空间小票打印通道未启用云/USB 打印，请先在打印设置中配置',
      );
    }
    const lockToken = await this.acquireSubmitSlot(
      storeId,
      saleOrderId,
      channel,
    );
    try {
      const submitted: { orderId: string; taskId: string | null } =
        channel === 'cloud'
          ? {
              orderId: await this.printCloud(storeId, saleOrderId, settings),
              taskId: null,
            }
          : await this.printUsb(
              storeId,
              saleOrderId,
              settings,
              operatorFallback,
            );
      // 锁值升级为该任务 ID：之后「确认这张票最终失败」时才能精确释放，
      // 避免按订单无条件删锁把另一终端正在下发的锁一起删掉（→ 重复出票）。
      await this.bindSubmitSlotTask(
        storeId,
        saleOrderId,
        lockToken,
        submitted.orderId,
      );
      return { ...submitted, channel };
    } catch (error) {
      // 三态处理：
      // - 明确失败（配置/资源错误、USB 通道未送达）→ 释放占位，允许立即重试
      // - 结果未知（云打印超时/网络中断）→ 保留占位到期自然过期，
      //   避免飞鹅其实已收单又立刻重发一张
      if (this.isDefiniteFailure(error, channel)) {
        await this.releaseSubmitSlot(storeId, saleOrderId, lockToken);
      }
      throw error;
    }
  }

  /**
   * 查询打印任务状态（收银端确认是否真的出纸）。
   * 传入 taskId 时只核对本次下发的那一张票，不读同订单历史补打的结果。
   */
  async getPrintTaskStatus(
    user: AuthenticatedUser,
    saleOrderId: number,
    taskId?: string,
  ): Promise<{ taskId: string; status: string; error: string | null } | null> {
    const storeId = await this.resolveMerchantStoreIdForView(user);
    // 轮询只需要确认订单属于当前门店（防止跨店读任务），不必每次加载整张小票明细
    const ownedOrder = await this.prisma.saleOrder.findFirst({
      where: { id: saleOrderId, storeId },
      select: { id: true },
    });
    if (!ownedOrder) {
      throw new NotFoundException('销售订单不存在');
    }
    if (taskId) {
      // 校验任务归属：同门店任意 taskId 都能查到会把别的订单/票种的回执当成本次结果
      return this.agentService.findTaskById(storeId, taskId, {
        domain: 'space',
        saleOrderId,
        target: SPACE_PRINT_TARGET,
      });
    }
    const latest = await this.agentService.findLatestTask(storeId, {
      domain: 'space',
      saleOrderId,
      target: SPACE_PRINT_TARGET,
    });
    // createdAt 只用于后端判断补打窗口，不对外暴露
    return latest
      ? { taskId: latest.taskId, status: latest.status, error: latest.error }
      : null;
  }

  /**
   * 最近结账的空间订单（补打入口数据源）。
   *
   * 刻意与打印通道、打印开关、下发结果完全解耦：结账只要生成了销售订单，
   * 事后就必须能从补打入口找回，否则「当时没勾打印 / 通道是 browser / 配置没拉到」
   * 这些与「要不要补打」无关的原因会让订单永久消失。
   */
  async listRecentSettledOrders(
    user: AuthenticatedUser,
    limit: number = RECENT_SETTLED_ORDER_DEFAULT_LIMIT,
  ): Promise<SpaceRecentSettledOrder[]> {
    const storeId = await this.resolveMerchantStoreIdForView(user);
    return this.printDataService.listRecentSettledOrders(storeId, limit);
  }

  /** 商家端测试空间小票打印（按门店配置通道向目标打印机下发测试小票）。 */
  async testPrintForMerchant(
    user: AuthenticatedUser,
  ): Promise<{ orderId: string }> {
    const storeId = await this.resolveMerchantStoreId(user);
    const settings = await this.printSettingsService.getByStoreId(storeId);
    const channel = settings.spacePrintChannel;
    if (channel === 'cloud') {
      const sn = settings.spaceCloudPrinterSn;
      if (!sn) {
        throw new BadRequestException(
          '空间打印未配置云打印机 SN，请先配置后再测试',
        );
      }
      const content =
        '<CB>空间打印测试</CB><BR><BR>测试小票，验证云打印链路正常。<BR><BR>时间：' +
        `${new Date().toLocaleString('zh-CN')}<BR><CUT>`;
      const orderId = await this.feiePrintService.printMessage(sn, content);
      return { orderId };
    }
    if (channel === 'usb') {
      const printer = settings.spaceUsbPrinter;
      const data = this.ticketBuilder.buildTest('空间打印测试');
      if (await this.agentService.isAgentBound(storeId)) {
        // target 沿用 cashier：Go 代理 resolvePrinter 只区分 kitchen，其余目标（含协议
        // 预留的 space）一律走门店「收银台」打印机，与空间小票落到同一台的预期一致。
        // deviceId 由代理按上报的设备列表选择具体打印机；旧代理忽略该字段时行为不变。
        const result = await this.agentService.dispatch(
          storeId,
          {
            taskId: PrintAgentService.newTaskId(),
            target: 'cashier',
            deviceId: settings.spaceUsbPrinter ?? undefined,
            dataBase64: data.toString('base64'),
          },
          { domain: 'space' },
        );
        if (!result.ok) {
          throw new ServiceUnavailableException(result.message);
        }
        return { orderId: result.taskId };
      }
      const orderId = await this.usbPrintService.printRaw(
        data,
        printer ?? undefined,
      );
      return { orderId };
    }
    throw new BadRequestException(
      '空间小票打印通道未启用云/USB 打印，请先在打印设置中配置',
    );
  }

  /** 商家端探测可用打印机：门店已绑定打印代理时返回代理上报列表，否则服务器本机探测。 */
  async listUsbDevices(user: AuthenticatedUser): Promise<UsbPrinterInfo[]> {
    const storeId = await this.resolveMerchantStoreIdForView(user);
    if (await this.agentService.isAgentBound(storeId)) {
      // windows 打印机的 type 对前端归一为 cups（同为"系统打印机"语义）
      const printers = await this.agentService.getPrinters(storeId);
      return printers.map((printer) => ({
        id: printer.id,
        name: printer.name,
        type: printer.type === 'windows' ? 'cups' : printer.type,
      }));
    }
    return this.usbPrintService.listDevices();
  }

  /** 云打印：组装飞鹅标签内容并下发到配置的云打印机。 */
  private async printCloud(
    storeId: number,
    saleOrderId: number,
    settings: Awaited<ReturnType<SpacePrintSettingsService['getByStoreId']>>,
  ): Promise<string> {
    const sn = settings.spaceCloudPrinterSn;
    if (!sn) {
      throw new BadRequestException(
        '空间打印未配置云打印机 SN，请先在打印设置中配置',
      );
    }
    const order = await this.printDataService.loadOrder(storeId, saleOrderId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const lines: string[] = [];
    lines.push(`<CB>${store?.name ?? '门店'}</CB><BR>`);
    lines.push('<C>消费小票</C><BR>');
    lines.push(`空间：${order.spaceName}<BR>`);
    if (order.guestName) {
      lines.push(`顾客：${order.guestName}<BR>`);
    }
    if (order.guestCount != null) {
      // 数字与汉字之间不留半角空格：热敏机中文模式下空格按全角宽度出纸，会拉出一个字的缝
      lines.push(`人数：${order.guestCount}人<BR>`);
    }
    lines.push(`开台：${order.startTimeLabel}<BR>`);
    lines.push(`结账：${order.endTimeLabel}<BR>`);
    lines.push(`时长：${order.durationLabel}<BR>`);
    lines.push(`计费：${order.billingModeLabel}<BR>`);
    if (order.hourlyRate != null) {
      lines.push(`台位费单价：￥${order.hourlyRate.toFixed(2)}/小时<BR>`);
    }
    lines.push('--------------------------------<BR>');
    if (order.items.length > 0) {
      lines.push('商品明细<BR>');
      order.items.forEach((item) => {
        // 自助下单商品：商品名后拼「 (自助)」标注（半角括号，热敏机 ASCII 字库最规整）
        const name =
          item.sourceType === 'member_self_order'
            ? `${item.name} (自助)`
            : item.name;
        lines.push(
          `${name} x${item.quantity}  ￥${item.subtotal.toFixed(2)}<BR>`,
        );
        // 规格另起一行（对齐餐饮扫码点餐小票口径）
        if (item.specNames && item.specNames.length > 0) {
          lines.push(`  ${item.specNames.join('、')}<BR>`);
        }
      });
      lines.push(`商品合计：￥${order.itemsCost.toFixed(2)}<BR>`);
    }
    // 台位费：不占商品明细行，作为「商品合计」下方的单列汇总行
    if (order.timeCost > 0) {
      lines.push(
        `台位费 (${order.timeFeeLabel})：￥${order.timeCost.toFixed(2)}<BR>`,
      );
    }
    // 券面消费行：券面已在 purelyClub 付过，与下方「预付抵扣」等额冲抵。
    // 两行必须成对出现，否则票面只剩单向抵扣，明细加总与合计对不上。
    if (order.voucherConsumption > 0) {
      lines.push(
        `券面消费 (团购券)：￥${order.voucherConsumption.toFixed(2)}<BR>`,
      );
    }
    if (order.renewDeduction > 0) {
      lines.push(`续费抵扣：-￥${order.renewDeduction.toFixed(2)}<BR>`);
    }
    if (order.prepaidDeduction > 0) {
      lines.push(`预付抵扣：-￥${order.prepaidDeduction.toFixed(2)}<BR>`);
    }
    if (order.selfOrderDeduction > 0) {
      lines.push(
        `自助下单 (已支付)：-￥${order.selfOrderDeduction.toFixed(2)}<BR>`,
      );
    }
    // 卡抵扣是「付款方式从现金换成卡权益」，营业额里台位费仍存在，故单列冲减
    if (order.cardDeduction > 0) {
      lines.push(`会员卡抵扣：-￥${order.cardDeduction.toFixed(2)}<BR>`);
    }
    lines.push('--------------------------------<BR>');
    // 合计可能为负数（应退），与 USB 通道一致保持常规字重
    lines.push(`合计：￥${order.totalAmount.toFixed(2)}<BR>`);
    lines.push(`支付方式：${order.paymentMethodLabel}<BR>`);
    if (order.note) {
      lines.push(`备注：${order.note}<BR>`);
    }
    if (order.operatorName) {
      lines.push(`操作员：${order.operatorName}<BR>`);
    }
    lines.push('<BR>');
    lines.push('<C>谢谢惠顾，欢迎再次光临</C><BR>');
    lines.push('<CUT>');
    return this.feiePrintService.printMessage(sn, lines.join(''));
  }

  /** USB 打印：组装 ESC/POS 字节流，代理推送优先，本机回退。 */
  private async printUsb(
    storeId: number,
    saleOrderId: number,
    settings: Awaited<ReturnType<SpacePrintSettingsService['getByStoreId']>>,
    operatorFallback: string | null,
  ): Promise<{ orderId: string; taskId: string | null }> {
    const order = await this.printDataService.loadOrder(storeId, saleOrderId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const ticket: SpaceEscPosTicket = {
      storeName: store?.name ?? '',
      title: '消费小票',
      spaceName: order.spaceName,
      guestName: order.guestName,
      guestCount: order.guestCount,
      startTimeLabel: order.startTimeLabel,
      endTimeLabel: order.endTimeLabel,
      durationLabel: order.durationLabel,
      billingModeLabel: order.billingModeLabel,
      hourlyRate: order.hourlyRate,
      timeCost: order.timeCost,
      timeFeeLabel: order.timeFeeLabel,
      items: order.items,
      itemsCost: order.itemsCost,
      renewDeduction: order.renewDeduction,
      prepaidDeduction: order.prepaidDeduction,
      selfOrderDeduction: order.selfOrderDeduction,
      cardDeduction: order.cardDeduction,
      voucherConsumption: order.voucherConsumption,
      totalAmount: order.totalAmount,
      paymentMethodLabel: order.paymentMethodLabel,
      note: order.note,
      operatorName: order.operatorName ?? operatorFallback,
      footer: '谢谢惠顾，欢迎再次光临',
    };
    const data = this.ticketBuilder.buildSpaceTicket(ticket);

    if (await this.agentService.isAgentBound(storeId)) {
      // target 沿用 cashier：Go 代理 resolvePrinter 只区分 kitchen，其余目标（含协议
      // 预留的 space）一律走门店「收银台」打印机，与空间小票落到同一台的预期一致。
      // deviceId 让代理按门店选择落到具体打印机；旧代理忽略该字段时行为不变。
      const result = await this.agentService.dispatch(
        storeId,
        {
          taskId: PrintAgentService.newTaskId(),
          target: 'cashier',
          deviceId: settings.spaceUsbPrinter ?? undefined,
          dataBase64: data.toString('base64'),
        },
        { domain: 'space', saleOrderId },
      );
      if (!result.ok) {
        throw new ServiceUnavailableException(result.message);
      }
      // 代理任务：taskId 即回执查询键（本机提交没有代理台账）
      return { orderId: result.taskId, taskId: result.taskId };
    }
    const receiptId = await this.usbPrintService.printRaw(
      data,
      settings.spaceUsbPrinter ?? undefined,
    );
    return { orderId: receiptId, taskId: null };
  }

  /**
   * 占位本次提交：SET NX 原子抢占，避免两个请求都查不到近期任务后各自下发。
   * 返回持有者令牌。
   *
   * Redis 故障时云打印与 USB 一律拒绝下发：
   * - 云打印不落本地台账，没有第二道防重，放行会在并发补打时直接重复出纸；
   * - USB 也没有可靠兜底——服务器本机 USB 根本不写代理台账，代理下发又是
   *   「先查台账再写台账」，Redis 故障时两个并发请求都会查空，各自下发一张。
   * 宁可让收银员稍后重试（并人工确认是否已出纸），也不要静默打出两张。
   */
  private async acquireSubmitSlot(
    storeId: number,
    saleOrderId: number,
    channel: 'cloud' | 'usb' | 'browser',
  ): Promise<string | null> {
    const token = randomUUID();
    try {
      const acquired = await this.redisService.setIfAbsent(
        buildSubmitLockKey(storeId, saleOrderId),
        token,
        SUBMIT_LOCK_TTL_SECONDS,
      );
      if (!acquired) {
        throw new ConflictException('该订单正在打印中，请稍后确认出纸结果');
      }
      return token;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      this.logger.warn(
        `[space-print] 提交占位不可用，拒绝下发 storeId=${storeId} saleOrderId=${saleOrderId} channel=${channel} reason=${error instanceof Error ? error.name : 'UnknownError'}`,
      );
      throw new ServiceUnavailableException(
        '打印并发保护暂不可用，请稍后确认是否已出纸后再试',
      );
    }
  }

  /**
   * 把提交占位从请求令牌绑定到任务 ID（下发成功后调用，保留剩余租约）。
   * 令牌不匹配说明锁已被新请求接管，此时不覆盖，避免抢走别人的锁；
   * 租约已到期或无过期时间（PTTL <= 0）时放弃绑定，绝不写入无期限的锁
   * ——绑定失败只影响「按任务释放」的粒度，不会产生永久 409。
   */
  private async bindSubmitSlotTask(
    storeId: number,
    saleOrderId: number,
    token: string | null,
    taskId: string,
  ): Promise<void> {
    if (!token) return;
    try {
      await this.redisService.evalScript(
        BIND_LOCK_TASK_SCRIPT,
        [buildSubmitLockKey(storeId, saleOrderId)],
        [token, taskId],
      );
    } catch {
      // 绑定失败退化为原令牌锁：仍可用令牌释放，只是补打要等租约到期
    }
  }

  /**
   * 释放提交占位（仅明确失败或确认任务最终失败时调用）。
   * 按持有者比对删除：holder 为请求令牌（下发当场失败）或 taskId（补打前确认失败），
   * 因此不会误删另一终端正在下发的锁。
   */
  private async releaseSubmitSlot(
    storeId: number,
    saleOrderId: number,
    holder: string | null,
  ): Promise<void> {
    if (!holder) return;
    try {
      await this.redisService.evalScript(
        RELEASE_LOCK_SCRIPT,
        [buildSubmitLockKey(storeId, saleOrderId)],
        [holder],
      );
    } catch {
      // 释放失败只影响连点窗口，等租约自然过期
    }
  }

  /**
   * 明确未送达的判定：
   * - 参数/资源类异常（未配置 SN、订单不存在）一定没发出去；
   * - USB 通道失败（代理离线、本机写设备失败）也没有进入打印；
   * - 云通道的失败可能是超时（飞鹅已收单），按「结果未知」处理，保留占位。
   */
  private isDefiniteFailure(error: unknown, channel: 'cloud' | 'usb'): boolean {
    if (error instanceof BadRequestException) return true;
    return channel === 'usb';
  }

  /**
   * 销售记录补打的门店与权限：当前门店必须同时满足 sales:view + space:view +
   * operation-entry:create（AND）。`RequirePermissions` 多项是 OR，故在服务层逐项校验。
   * 不要求 sales:delete：能补打不等于能删单。
   */
  private async resolveSalesReceiptStoreId(
    user: AuthenticatedUser,
  ): Promise<number> {
    const forbidden = '无权从销售记录打印空间小票';
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'sales:view',
      forbidden,
    );
    await this.commerceAccessService.ensureCanAccessStore(
      user,
      storeId,
      'space:view',
      forbidden,
    );
    await this.commerceAccessService.ensureCanAccessStore(
      user,
      storeId,
      'operation-entry:create',
      forbidden,
    );
    return storeId;
  }

  private async resolveMerchantStoreId(
    user: AuthenticatedUser,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'operation-entry:create',
      '无权操作空间小票打印',
    );
  }

  private async resolveMerchantStoreIdForView(
    user: AuthenticatedUser,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      '无权查看空间小票打印设备',
    );
  }
}
