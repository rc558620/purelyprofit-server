// 新用户额度服务的测试替身（供需要注入 NewCustomerQuotaService 的 test module 复用）
//
// 为什么需要它：`NewCustomerQuotaService` 只依赖 PrismaService，但被
// DashboardHomeService、PlatformMembershipOrderService、Pulse 会员写操作服务等
// 注入。这些服务的 test module 只关心自己的业务分支，额度相关的断言由
// `new-customer-quota.service.spec.ts` 单独覆盖，这里提供一个**不会抛错**的替身即可，
// 避免在每个 spec 里各写一份（漏一个方法就变成运行期 undefined is not a function）。
//
// ⚠️ 新增公开方法时请同步补到这里，否则依赖它的 test module 会在调用时才炸。

import type {
  ConsumeNewCustomerQuotaResult,
  NewCustomerQuotaLogItem,
  NewCustomerQuotaOverview,
  NewCustomerQuotaTier,
} from './new-customer-quota.types';

/** 默认额度概览：剩余充足、累计为 0 */
export const NEW_CUSTOMER_QUOTA_MOCK_OVERVIEW: NewCustomerQuotaOverview = {
  storeId: 0,
  remaining: 100,
  warningThreshold: 10,
  totalRecharged: 0,
  totalGranted: 0,
  totalConsumed: 0,
};

export interface NewCustomerQuotaServiceMock {
  getOverview: jest.Mock;
  getTiers: jest.Mock;
  getLogs: jest.Mock;
  hasRemaining: jest.Mock;
  isNewCustomer: jest.Mock;
  recharge: jest.Mock;
  grantByPlan: jest.Mock;
  clear: jest.Mock;
  consumeForNewCustomer: jest.Mock;
  /** 覆盖默认返回值（按 storeId 返回不同概览等场景） */
  setOverview: (overview: Partial<NewCustomerQuotaOverview>) => void;
}

export function createNewCustomerQuotaServiceMock(): NewCustomerQuotaServiceMock {
  const overview: NewCustomerQuotaOverview = {
    ...NEW_CUSTOMER_QUOTA_MOCK_OVERVIEW,
  };
  const tiers: NewCustomerQuotaTier[] = [];
  const logs: NewCustomerQuotaLogItem[] = [];

  return {
    getOverview: jest.fn().mockResolvedValue(overview),
    getTiers: jest.fn().mockReturnValue(tiers),
    getLogs: jest.fn().mockResolvedValue(logs),
    // 默认「还有额度」：额度耗尽是独立的拒绝分支，不该让其它用例意外走进去
    hasRemaining: jest.fn().mockResolvedValue(true),
    isNewCustomer: jest.fn().mockResolvedValue(false),
    recharge: jest.fn().mockResolvedValue(overview),
    grantByPlan: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    consumeForNewCustomer: jest.fn().mockResolvedValue({
      consumed: true,
      remaining: overview.remaining,
    } satisfies ConsumeNewCustomerQuotaResult),
    setOverview: (patch: Partial<NewCustomerQuotaOverview>): void => {
      Object.assign(overview, patch);
    },
  };
}
