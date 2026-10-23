import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PrismaService,
  TX_TIMEOUT_SHORT,
} from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import { maskPhone, normalizePhone } from '../../marketing/marketing.utils';

/** 微信无手机号用户的占位手机号前缀（三态之一，不可用于匹配顾客） */
const CLUB_WECHAT_PHONE_PREFIX = 'club_wechat:';

/** 建档跳过原因：全部是**正常业务分支**，不是异常，不进 error 日志 */
export type CareRecordSkipReason =
  | 'no-phone'
  | 'placeholder-phone'
  | 'customer-not-found'
  | 'already-exists'
  /** 门店未开通：注册时未选择「SPA/养生/美容/」模式，本功能整体不运行 */
  | 'module-disabled';

/**
 * 建档结果。
 *
 * 'failed' 表示真正的系统异常（DB 错误、约束冲突等）：此时结账已提交成功，
 * 存在「结账成功但建档失败」的不一致窗口，由 error 级结构化日志 + 告警覆盖，
 * 补偿入口见风险说明（按 session_id 幂等重放）。
 */
export type CareRecordWriteOutcome =
  | { status: 'created'; customerId: number; seq: number }
  | { status: 'skipped'; reason: CareRecordSkipReason }
  | { status: 'failed'; reason: string };

export interface WriteCareRecordInput {
  storeId: number;
  sessionId: number;
  /** 场次登记的客人手机号（三态：真实号码 / `club_wechat:{openid}` 占位值 / 空） */
  guestPhone: string | null;
  /** 护理发生时间 = 结账时间（毫秒） */
  visitAt: number;
  /** 护理项目名快照（已剔除系统抵扣项） */
  serviceName: string;
  /** 本次消费金额（元，对外口径；落库转分） */
  amountYuan: number;
  /** 护理师姓名快照；无技师时为 null */
  technicianName: string | null;
  /** 建档操作人；倒计时自动结账（系统用户）为 null */
  staffId: number | null;
  /** 请求追踪 ID；自动结账链路无 HTTP 请求，可缺省 */
  requestId?: string;
}

/**
 * 会员护理档案写入服务（唯一写入方）。
 *
 * 设计要点：
 * 1. **只在结账成功后调用**，且跑在**独立短事务**里，不并入结账主事务。
 *    原因：PostgreSQL 中事务内任意一条语句失败会中止整个事务，此后即使
 *    catch 住异常，后续语句与 COMMIT 也必然失败——「事务内 try/catch 保证
 *    建档失败不回滚结账」在 PG 上做不到。独立事务 + `sessionId` 幂等 + 失败
 *    error 日志告警，是同时满足可观测与结账不被拖垮的唯一可行结构。
 * 2. **并发安全 seq 自增**：先 `FOR UPDATE` 锁住顾客行（顾客行一定存在，
 *    锁必然生效），再取 `MAX(seq)`。直接对 care_records 做
 *    `MAX(seq) ... FOR UPDATE` 在首条建档时无行可锁，会锁不住并发。
 * 3. 匹配不到会员 / 无手机号 / 占位手机号 / 已建档 → 提前 return，
 *    属于正常业务分支，不抛异常、不进 catch。
 */
@Injectable()
export class SpaceCareRecordWriterService {
  private readonly logger = new Logger(SpaceCareRecordWriterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async writeAfterSettlement(
    input: WriteCareRecordInput,
  ): Promise<CareRecordWriteOutcome> {
    // 入参防御：sessionId 是幂等键，缺失/非法时 findUnique 的 where 会被 Prisma
    // 静默忽略该条件，导致误判「已建档」而永远写不进档案——必须显式拦截。
    if (!Number.isInteger(input.sessionId) || input.sessionId <= 0) {
      this.logger.error(
        `[CARE_RECORD_WRITE_FAILED] reason=invalid-session-id requestId=${input.requestId ?? '-'} storeId=${input.storeId} sessionId=${String(input.sessionId)} phone=${maskPhone(input.guestPhone)}`,
      );
      return { status: 'failed', reason: 'invalid-session-id' };
    }

    // 功能档位门禁：仅注册时选择「SPA/养生/美容/」模式的门店建档。
    // 其余门店后端整体不运行会员护理档案——不写库、不产生任何档案记录。
    if (!(await this.isMemberCareEnabled(input.storeId))) {
      return { status: 'skipped', reason: 'module-disabled' };
    }

    const phone = resolveCustomerPhone(input.guestPhone);
    if (!phone) {
      const reason: CareRecordSkipReason = input.guestPhone?.trim()
        ? 'placeholder-phone'
        : 'no-phone';
      return { status: 'skipped', reason };
    }

    try {
      return await this.prisma.$transaction(
        (tx: Prisma.TransactionClient) =>
          this.insertWithinTransaction(tx, input, phone),
        { timeout: TX_TIMEOUT_SHORT },
      );
    } catch (error) {
      this.logWriteFailure(input, phone, error);
      return { status: 'failed', reason: describeWriteError(error) };
    }
  }

  /**
   * 读取门店会员护理档案档位。
   * 查询失败按「未开通」处理（最小权限原则）：宁可漏建一条档案，
   * 也不能给未开通门店凭空生成护理记录。
   */
  private async isMemberCareEnabled(storeId: number): Promise<boolean> {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { memberCareEnabled: true },
      });
      return store?.memberCareEnabled === true;
    } catch (error: unknown) {
      this.logger.warn(
        `[CARE_RECORD_STORE_FLAG_FALLBACK] storeId=${storeId} 读取会员护理档案档位失败，按未开通处理: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async insertWithinTransaction(
    tx: Prisma.TransactionClient,
    input: WriteCareRecordInput,
    phone: string,
  ): Promise<CareRecordWriteOutcome> {
    const customer = await tx.marketingCustomer.findFirst({
      where: { storeId: input.storeId, phone, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      return { status: 'skipped', reason: 'customer-not-found' };
    }

    const existing = await tx.careRecord.findUnique({
      where: { sessionId: input.sessionId },
      select: { id: true },
    });
    if (existing) {
      return { status: 'skipped', reason: 'already-exists' };
    }

    const seq = await this.resolveNextSeq(tx, customer.id);
    await tx.careRecord.create({
      data: {
        storeId: input.storeId,
        customerId: customer.id,
        seq,
        visitAt: new Date(input.visitAt),
        serviceName: input.serviceName,
        amountCents: Money.fromInputYuan(input.amountYuan).toDbCents(),
        sessionId: input.sessionId,
        technicianName: input.technicianName,
        createdByStaffId: input.staffId,
      },
    });

    return { status: 'created', customerId: customer.id, seq };
  }

  /**
   * 顾客维度 seq 自增（事务内，并发安全）。
   *
   * 先锁顾客行再聚合：顾客行由 `insertWithinTransaction` 保证存在，
   * 因此行锁必然命中，两个并发结账会串行取号。
   */
  private async resolveNextSeq(
    tx: Prisma.TransactionClient,
    customerId: number,
  ): Promise<number> {
    await tx.$queryRaw`
      SELECT id
      FROM marketing_customers
      WHERE id = ${customerId}
      FOR UPDATE
    `;
    const aggregated = await tx.careRecord.aggregate({
      where: { customerId },
      _max: { seq: true },
    });
    return (aggregated._max.seq ?? 0) + 1;
  }

  /**
   * 系统异常的结构化 error 日志。
   *
   * 禁止静默失败：这里必须留下可告警、可补偿的痕迹。
   * 手机号统一走 maskPhone 脱敏，禁止打印完整号码。
   */
  private logWriteFailure(
    input: WriteCareRecordInput,
    phone: string,
    error: unknown,
  ): void {
    this.logger.error(
      `[CARE_RECORD_WRITE_FAILED] requestId=${input.requestId ?? 'none'} ` +
        `sessionId=${input.sessionId} storeId=${input.storeId} ` +
        `phone=${maskPhone(phone)} code=${describeWriteError(error)} ` +
        `reason=${error instanceof Error ? error.name : 'UnknownError'}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

/** 手机号三态归一：真实号码 → 11 位纯数字；占位值 / 空 / 非法 → null */
export function resolveCustomerPhone(
  guestPhone: string | null | undefined,
): string | null {
  const trimmed = guestPhone?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toLowerCase().startsWith(CLUB_WECHAT_PHONE_PREFIX)) {
    return null;
  }
  return normalizePhone(trimmed);
}

/** 抽取错误码摘要，供日志与告警规则匹配 */
function describeWriteError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return 'UnknownError';
}
