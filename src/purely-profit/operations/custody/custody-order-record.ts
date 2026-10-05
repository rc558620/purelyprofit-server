// 建单落库：单号冲突重试 + 幂等键并发兜底。
//
// 抽成独立函数以便单测覆盖「并发双写只落一单」这一关键路径，
// 同时让写服务保持聚焦在编排与状态流转。
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildOrderNo } from './custody.domain';
import type { CustodyCreateInput } from './custody.types';

/** 单号重复时的最大重试次数 */
const ORDER_NO_MAX_RETRY = 3;

/** 落库所需的最小客户端：事务客户端与非事务客户端均满足 */
export type CustodyOrderRecordClient = Pick<
  Prisma.TransactionClient,
  'custodyOrder'
>;

export async function createCustodyOrderRecord(
  prisma: CustodyOrderRecordClient,
  input: CustodyCreateInput,
  requireMemberConfirm: boolean,
) {
  for (let attempt = 0; attempt < ORDER_NO_MAX_RETRY; attempt += 1) {
    try {
      return await prisma.custodyOrder.create({
        data: {
          storeId: input.storeId,
          orderNo: buildOrderNo(input.storedAt),
          memberId: input.member.memberId,
          memberNameSnapshot: input.member.memberName,
          memberPhoneSnapshot: input.member.memberPhone,
          productId: input.productId,
          productName: input.productName,
          specName: input.specName,
          unit: input.unit,
          totalQty: input.totalQty,
          remainingQty: input.totalQty,
          stockMode: input.stockMode,
          location: input.location,
          storedAt: input.storedAt,
          expireAt: input.expireAt,
          status: requireMemberConfirm ? 'draft' : 'stored',
          sourceOrderId: input.sourceOrderId,
          createdByStaffId: input.createdByStaffId,
          createdByNameSnapshot: input.createdByName,
          note: input.note,
          image: input.image,
          idempotencyKey: input.idempotencyKey,
        },
      });
    } catch (error) {
      // 幂等键冲突：并发双写被唯一索引拦截，读取已有单据返回（重复提交幂等）
      const duplicatedIdempotency =
        input.idempotencyKey !== null &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        JSON.stringify(error.meta?.target ?? '').includes('idempotency_key');
      if (duplicatedIdempotency) {
        const existing = await findIdempotentOrder(
          prisma,
          input.storeId,
          input.idempotencyKey ?? undefined,
        );
        if (existing) {
          return existing;
        }
      }
      const isLastAttempt = attempt === ORDER_NO_MAX_RETRY - 1;
      if (isLastAttempt) {
        throw error;
      }
    }
  }
  throw new ConflictException('存单号生成冲突，请稍后重试');
}

/** 幂等命中查询：同门店 + 同一幂等键视为同一次提交 */
export async function findIdempotentOrder(
  prisma: CustodyOrderRecordClient,
  storeId: number,
  idempotencyKey: string | undefined,
) {
  if (!idempotencyKey) {
    return null;
  }
  return prisma.custodyOrder.findFirst({
    where: { storeId, idempotencyKey, deletedAt: null },
  });
}
