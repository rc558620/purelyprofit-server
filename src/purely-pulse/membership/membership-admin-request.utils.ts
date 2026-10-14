import { BadRequestException } from '@nestjs/common';
import type { StoreSubAccountRole } from '@prisma/client';
import type { PulseAdminMemberSubAccountQuotaDto } from './dto/pulse-membership-admin-members.sub-account.request.dto';
import type { PulseAdminSubAccountQuotaMutationInput } from './membership.types';

/**
 * 管理端会员 controller 的入参归一化工具。
 *
 * 抽离的原因：members/:id 系列接口有两个历史包袱 ——
 * 1. 路径参数可能缺失，需要回退到 body 里的会员身份字段；
 * 2. 子账号额度兼容新旧两套字段名。
 * 这些逻辑纯吃入参、不依赖 Nest 注入，因此按 directory 既有约定单独成文件。
 */

/** 兼容历史调用方的会员身份字段（只有字符串形态才是有效回退） */
type AdminMemberMutationFallback = {
  userId?: string;
  memberId?: string;
  id?: string;
};

/**
 * 解析正整数 ID。
 *
 * 非法输入返回 undefined：非整数、非正数，以及被前端误塞进路径段的 JSON 串
 * （形如 `{memberId: 18}`），后者 parse 会得到 NaN，同样要挡掉。
 */
export function parsePositiveMemberId(value?: string): number | undefined {
  if (!value || value.startsWith('{') || value.endsWith('}')) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

/**
 * 解析管理端会员 ID：优先用路径参数，缺失时依次回退 body 里的
 * memberId / userId / id（purelyPulse 多个弹窗提交结构不一致的兼容层）。
 */
export function resolveAdminMemberId(
  rawMemberId: string,
  fallback?: unknown,
): number {
  const fallbackRecord = toAdminMemberMutationFallback(fallback);
  const candidate =
    parsePositiveMemberId(rawMemberId) ??
    parsePositiveMemberId(fallbackRecord.memberId) ??
    parsePositiveMemberId(fallbackRecord.userId) ??
    parsePositiveMemberId(fallbackRecord.id);

  if (candidate === undefined) {
    throw new BadRequestException('缺少合法的会员 ID');
  }

  return candidate;
}

/** 把子账号额度请求归一化：quota 优先，回退旧字段 subAccountQuota，缺省为 0 */
export function normalizeAdminSubAccountQuotaInput(
  dto: PulseAdminMemberSubAccountQuotaDto,
): PulseAdminSubAccountQuotaMutationInput {
  return {
    quota: dto.quota ?? dto.subAccountQuota ?? 0,
    reason: dto.reason,
    roleSummary: dto.roleSummary?.map((item) => ({
      slot: item.slot,
      role: item.role as StoreSubAccountRole,
      status: item.status,
      isAssigned: item.isAssigned,
    })),
  };
}

function toAdminMemberMutationFallback(
  fallback?: unknown,
): AdminMemberMutationFallback {
  if (!fallback || typeof fallback !== 'object') {
    return {};
  }

  const record = fallback as Record<string, unknown>;
  return {
    userId: typeof record.userId === 'string' ? record.userId : undefined,
    memberId: typeof record.memberId === 'string' ? record.memberId : undefined,
    id: typeof record.id === 'string' ? record.id : undefined,
  };
}
