// 新用户额度跨层共用件：业务异常构造（service 与 .write.ts 都用同一份文案与业务码）
import { ForbiddenException } from '@nestjs/common';
import {
  NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
  NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
} from './new-customer-quota.constants';

/**
 * 额度耗尽：C 端据此提示「联系商家」。
 *
 * 在建单事务里抛出时会让整笔事务回滚，因此调用方必须保证「订单落库 + 扣减」
 * 在同一事务内——扣不到额度就不能留下订单。
 */
export const buildQuotaExhaustedException = (): ForbiddenException =>
  new ForbiddenException({
    message: NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
    code: NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
  });
