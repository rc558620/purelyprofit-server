// 成本建单幂等服务：Idempotency-Key 校验、请求指纹、占位抢占与响应快照回放。
//
// 复用 `idempotency_records` 表（与录入订单、扫码点餐共用一套存储），
// 靠 `(scope, actorId, idempotencyKey)` 唯一键做并发闸门，不额外建表。
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { CostRecordResponseDto } from './dto/costs-response.dto';

/** 幂等记录作用域：商家端手工成本建单 */
const COSTS_CREATE_SCOPE = 'profit:cost-record:create';

/** 幂等记录保留时长：24 小时（覆盖「服务端已落库、客户端隔天重试」的极端窗口） */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** 幂等键最小长度：过短的占位值不视为有效键，避免误占键位 */
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;

/** 关联资源类型：成本记录 */
const RESOURCE_TYPE = 'cost_record';

/** 幂等命中时的处理结果：回放首次响应，或提示首次请求仍在处理中 */
export interface CostsIdempotencyRecord {
  status: string;
  requestHash: string;
  responseSnapshot: Prisma.JsonValue | null;
}

/**
 * 成本建单幂等服务。
 *
 * 语义与录入订单、销售建单一致：
 * - 记录 `succeeded` + 快照 → 原样回放首次响应（客户端拿到同一条成本 ID）；
 * - 记录停在 `processing` → 409，让客户端用**同一个 key** 重试，而不是重复记账。
 */
@Injectable()
export class CostsIdempotencyService {
  private readonly logger = new Logger(CostsIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 归一幂等键：未传（老版本前端）返回 null 表示不做幂等；传了但过短直接 400。
   *
   * `Idempotency-Key` 是可选的加固项，直接强制会打断尚未升级的调用方；
   * 但一旦声明就必须是有效键，否则「8 位以下」这类占位值会互相顶掉。
   */
  normalizeKey(raw: string | undefined): string | null {
    const trimmed = raw?.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.length < IDEMPOTENCY_KEY_MIN_LENGTH) {
      throw new BadRequestException(
        `Idempotency-Key 长度不足（至少 ${IDEMPOTENCY_KEY_MIN_LENGTH} 个字符）`,
      );
    }
    return trimmed;
  }

  /**
   * 请求指纹：同一 key 复用于不同内容时据此拦截。
   *
   * 只取对「生成哪一条记录」有影响的字段（门店 + 完整 DTO），
   * 操作员不参与：它是服务端按登录态解析的，客户端无法指定。
   */
  hashRequest(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  /** 读取当前操作人的幂等记录（提交前查重与并发撞键回归共用）。 */
  find(
    actorId: number,
    idempotencyKey: string,
  ): Promise<CostsIdempotencyRecord | null> {
    return this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_actorId_idempotencyKey: {
          scope: COSTS_CREATE_SCOPE,
          actorId,
          idempotencyKey,
        },
      },
      select: { status: true, requestHash: true, responseSnapshot: true },
    });
  }

  /** 同一 key 必须对应同一份请求：换了内容再复用 key，宁可报错也不能回放旧记录。 */
  ensureSameRequest(
    record: { requestHash: string },
    requestHash: string,
  ): void {
    if (record.requestHash !== requestHash) {
      throw new ConflictException(
        '幂等键已用于另一笔内容不同的成本记录，请刷新后重新提交',
      );
    }
  }

  /**
   * 幂等命中后的响应回放。
   *
   * `processing` 说明首次请求仍在写入（或已崩溃未回填）：此时返回 409，
   * 客户端用同一个 key 重试即可拿到最终结果，绝不会产生第二条成本。
   */
  resolveReplay(record: CostsIdempotencyRecord): CostRecordResponseDto {
    if (record.status !== 'succeeded' || record.responseSnapshot === null) {
      throw new ConflictException('该成本记录正在创建中，请稍后重试');
    }
    return record.responseSnapshot as unknown as CostRecordResponseDto;
  }

  /**
   * 占位：抢占幂等键。
   *
   * 唯一键本身就是并发闸门，放建单事务外可以把持锁时间压到最短；
   * 并发双击时后到者抛 P2002，由调用方回读记录做回放。
   */
  async claim(
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<number> {
    const record = await this.prisma.idempotencyRecord.create({
      data: {
        scope: COSTS_CREATE_SCOPE,
        actorId,
        idempotencyKey,
        requestHash,
        status: 'processing',
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
      select: { id: true },
    });
    return record.id;
  }

  /**
   * 落库成功后回填响应快照。
   *
   * 失败只告警：成本已经真实落库，此时让接口报错会诱导用户重复提交。
   * 记录停在 `processing` 时，同 key 重试会拿到 409「正在创建中」，
   * 不会产生第二条记录——这是可接受的降级。
   */
  async finalize(
    placeholderId: number,
    response: CostRecordResponseDto,
  ): Promise<void> {
    try {
      await this.prisma.idempotencyRecord.update({
        where: { id: placeholderId },
        data: {
          status: 'succeeded',
          resourceType: RESOURCE_TYPE,
          resourceId: Number(response.id),
          responseSnapshot: response as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `回填成本幂等快照失败 id=${placeholderId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 写入明确失败时清理占位，允许同 key 重试。
   *
   * 失败只告警：残留的 `processing` 记录会让同 key 重试收到 409，
   * 比误删安全，24 小时后随 TTL 清理。
   */
  async discard(placeholderId: number): Promise<void> {
    try {
      await this.prisma.idempotencyRecord.delete({
        where: { id: placeholderId },
      });
    } catch (error) {
      this.logger.warn(
        `清理成本幂等占位记录失败 id=${placeholderId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 并发占位撞唯一键（P2002）判定：只有这种情况才回读记录做回放。 */
  isDuplicateKeyError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
