// Pulse / 群发任务与失败退费服务
//
// 从 `pulse-sms.service.ts` 抽出：群发任务列表（运营定位失败任务）
// 与失败退费（把未送达部分退回门店短信余额并写 refund 流水）。
//
// 为什么独立成 service：这部分是**写链路**（Serializable 事务 + 钱包流水 +
// 任务退款标记），与账户一览/平台赠送的读链路没有共享状态；
// 拆开后两边都能守住 400 行 / 60 行复杂度阈值。
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SmsWalletLogType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../purely-profit/auth/strategies/jwt.strategy';
import {
  SMS_BROADCAST_REFUNDABLE_STATUS_VALUES,
  SMS_BROADCAST_DEFAULT_PAGE_SIZE,
} from '../../../purely-profit/marketing/sms/sms.constants';
import { PulseMembershipAccessService } from '../../membership/membership-access.service';
import { PULSE_ADMIN_SMS_MAX_PAGE_SIZE } from './dto/pulse-sms.request.dto';
import type {
  GetPulseAdminSmsBroadcastsQueryDto,
  RefundPulseAdminSmsBroadcastDto,
} from './dto/pulse-sms.request.dto';
import type {
  PulseAdminSmsBroadcastDto,
  PulseAdminSmsBroadcastRefundResultDto,
  PulseAdminSmsBroadcastsResponseDto,
} from './dto/pulse-sms.response.dto';

/** 群发任务列表查询字段（列表只需要投递结果概览，不取收件人明细） */
const SMS_BROADCAST_LIST_SELECT = {
  broadcastId: true,
  content: true,
  status: true,
  recipientCount: true,
  validMobileCount: true,
  successCount: true,
  failedCount: true,
  chargedAmountFen: true,
  refundedAmountFen: true,
  lastError: true,
  createdAt: true,
} as const;

/** 群发任务列表行快照：随 SMS_BROADCAST_LIST_SELECT 推导，避免两处漂移 */
type PulseSmsBroadcastRow = Prisma.SmsBroadcastTaskGetPayload<{
  select: typeof SMS_BROADCAST_LIST_SELECT;
}>;

/** 退费校验与金额折算所需的任务快照 */
interface PulseSmsBroadcastTaskSnapshot {
  id: number;
  status: string;
  unitPriceFen: number;
  chargedAmountFen: number;
  refundedAmountFen: number;
  smsSegments: number;
  validMobileCount: number;
  failedCount: number;
}

/** 退费事务参数（参数收敛成一个对象，避免超过 4 个入参） */
interface BroadcastRefundParams {
  storeId: number;
  broadcastId: string;
  taskId: number;
  refundableFen: number;
  description: string;
}

/** 可退费状态判定（与 DTO 校验同源，避免两处硬编码不一致） */
const isRefundableStatus = (status: string): boolean =>
  (SMS_BROADCAST_REFUNDABLE_STATUS_VALUES as readonly string[]).includes(
    status,
  );

/** 列表行 → 响应 DTO；refundable 由状态 + 是否已退过共同决定 */
const buildBroadcastDto = (
  row: PulseSmsBroadcastRow,
): PulseAdminSmsBroadcastDto => {
  return {
    broadcastId: row.broadcastId,
    content: row.content,
    status: row.status,
    recipientCount: row.recipientCount,
    validMobileCount: row.validMobileCount,
    successCount: row.successCount,
    failedCount: row.failedCount,
    chargedAmountFen: row.chargedAmountFen,
    refundedAmountFen: row.refundedAmountFen,
    refundable: isRefundableStatus(row.status) && row.refundedAmountFen === 0,
    lastError: row.lastError,
    createdAt: row.createdAt.getTime(),
  };
};

/** 退费金额折算：只退失败条数对应的金额，且不能超过任务剩余可退额度 */
const resolveRefundableFen = (task: PulseSmsBroadcastTaskSnapshot): number => {
  // 计费条数 = 每人分段数 × 有效收件人，反推每人分段数后按失败人数折算
  const perRecipientSegments =
    task.validMobileCount > 0
      ? Math.ceil(task.smsSegments / task.validMobileCount)
      : 0;
  const refundableFen = Math.min(
    task.failedCount * perRecipientSegments * task.unitPriceFen,
    task.chargedAmountFen - task.refundedAmountFen,
  );
  if (refundableFen <= 0) {
    throw new BadRequestException('该任务没有可退费金额');
  }

  return refundableFen;
};

/** 退费流水说明：带上失败人数，运营对账时能直接对上任务 */
const buildRefundDescription = (
  failedCount: number,
  reason: string | undefined,
): string =>
  `群发短信失败退费（${failedCount} 人未送达）${reason ? `：${reason}` : ''}`;

/**
 * 事务内完成退费：二次确认未退过 → 加余额 → 写 refund 流水 → 标记任务已退费。
 *
 * 返回退费后的门店短信余额。
 */
const applyBroadcastRefund = async (
  tx: Prisma.TransactionClient,
  params: BroadcastRefundParams,
): Promise<number> => {
  const { storeId, broadcastId, taskId, refundableFen, description } = params;

  // 事务内二次确认「未退过」：并发点两次也不能退两遍
  const fresh = await tx.smsBroadcastTask.findUniqueOrThrow({
    where: { id: taskId },
    select: { refundedAmountFen: true },
  });
  if (fresh.refundedAmountFen > 0) {
    throw new BadRequestException('该任务已退费，不能重复退费');
  }

  await tx.storeSmsAccount.upsert({
    where: { storeId },
    create: { storeId },
    update: {},
  });

  const account = await tx.storeSmsAccount.update({
    where: { storeId },
    data: {
      balanceFen: { increment: refundableFen },
      totalConsumedFen: { decrement: refundableFen },
    },
    select: { balanceFen: true },
  });

  await tx.smsWalletLog.create({
    data: {
      storeId,
      type: SmsWalletLogType.refund,
      changeFen: refundableFen,
      balanceAfterFen: account.balanceFen,
      description,
      broadcastId,
    },
  });

  await tx.smsBroadcastTask.update({
    where: { id: taskId },
    data: { refundedAmountFen: { increment: refundableFen } },
  });

  return account.balanceFen;
};

@Injectable()
export class PulseSmsBroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  /**
   * 门店群发任务列表（平台运营视角）。
   *
   * 用途：群发失败**不自动退费**，运营要能「看到哪些任务失败了、失败了多少人」，
   * 才能人工核实后走 {@link refundAdminSmsBroadcast}。没有这个列表，失败任务只能靠
   * 商家反馈才知道，退费链路等于断了。
   */
  async listAdminSmsBroadcasts(
    user: AuthenticatedUser,
    storeId: number,
    query: GetPulseAdminSmsBroadcastsQueryDto,
  ): Promise<PulseAdminSmsBroadcastsResponseDto> {
    await this.accessService.assertAdminMemberMutationAccess(user, storeId);

    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? SMS_BROADCAST_DEFAULT_PAGE_SIZE,
      PULSE_ADMIN_SMS_MAX_PAGE_SIZE,
    );

    const where = {
      storeId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.smsBroadcastTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SMS_BROADCAST_LIST_SELECT,
      }),
      this.prisma.smsBroadcastTask.count({ where }),
    ]);

    return {
      items: rows.map(buildBroadcastDto),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  /**
   * 群发失败退费：把**未送达**部分的钱退回门店短信余额，并写 refund 流水。
   *
   * 设计约束：
   * - 只退失败条数对应的金额（成功送达的不退），且一个任务只能退一次；
   * - 只允许 failed / partial_failed：`sending` 还有机会发成功，提前退费等于白送钱；
   * - 只允许平台运营发起（商家端没有入口），原因写入流水便于对账。
   */
  async refundAdminSmsBroadcast(
    user: AuthenticatedUser,
    storeId: number,
    broadcastId: string,
    dto: RefundPulseAdminSmsBroadcastDto,
  ): Promise<PulseAdminSmsBroadcastRefundResultDto> {
    // 退费是加钱操作：权限校验必须在查任务之前，避免越权探测到「任务存在但无权」
    await this.accessService.assertAdminMemberMutationAccess(user, storeId);

    const task = await this.loadTaskOrThrow(storeId, broadcastId);
    this.assertRefundable(task);

    const refundableFen = resolveRefundableFen(task);
    const description = buildRefundDescription(
      task.failedCount,
      dto.reason?.trim(),
    );

    const balanceFen = await this.prisma.$transaction(
      (tx) =>
        applyBroadcastRefund(tx, {
          storeId,
          broadcastId,
          taskId: task.id,
          refundableFen,
          description,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      broadcastId,
      refundedAmountFen: refundableFen,
      failedCount: task.failedCount,
      balanceFen,
    };
  }

  private assertRefundable(task: PulseSmsBroadcastTaskSnapshot): void {
    if (!isRefundableStatus(task.status)) {
      throw new BadRequestException(
        '只有发送失败或部分失败的任务可以退费；发送中的任务请等待派发结束',
      );
    }
    if (task.refundedAmountFen > 0) {
      throw new BadRequestException('该任务已退费，不能重复退费');
    }
  }

  private async loadTaskOrThrow(
    storeId: number,
    broadcastId: string,
  ): Promise<PulseSmsBroadcastTaskSnapshot> {
    const task = await this.prisma.smsBroadcastTask.findFirst({
      where: { storeId, broadcastId },
      select: {
        id: true,
        status: true,
        unitPriceFen: true,
        chargedAmountFen: true,
        refundedAmountFen: true,
        smsSegments: true,
        validMobileCount: true,
        failedCount: true,
      },
    });
    if (!task) {
      throw new NotFoundException('群发任务不存在');
    }

    return task;
  }
}
