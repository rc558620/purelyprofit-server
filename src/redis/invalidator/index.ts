/**
 * 缓存失效统一入口
 *
 * 本文件作为 cache-invalidator 相关能力的对外导出桶，
 * 将分散在 src/redis 根目录的 invalidator 实现收敛到统一命名空间。
 */

// 主编排服务
export { CacheInvalidatorService } from '../cache-invalidator.service';

// 领域失效服务（按域分组）
export { CacheInvalidatorFinanceService } from '../cache-invalidator-finance.service';
export { CacheInvalidatorMembershipService } from '../cache-invalidator-membership.service';
export { CacheInvalidatorProfitReadService } from '../cache-invalidator-profit-read.service';
export { CacheInvalidatorPulseService } from '../cache-invalidator-pulse.service';

// Registry 与 Provider 类型
export {
  buildCacheInvalidatorRegistry,
  type CacheInvalidatorProvider,
} from '../cache-invalidator.registry';

// Provider 工厂与集合（按域）
export {
  createFinanceCacheInvalidatorRegistry,
  type FinanceCacheInvalidatorInput,
  type FinanceCacheInvalidatorRegistry,
} from '../cache-invalidator-finance.providers';

export {
  createMembershipCacheInvalidatorRegistry,
  type MembershipCacheInvalidatorInput,
  type MembershipCacheInvalidatorRegistry,
} from '../cache-invalidator-membership.providers';

export {
  createProfitReadCacheInvalidatorRegistry,
  type ProfitReadCacheInvalidatorInput,
  type ProfitReadCacheInvalidatorRegistry,
} from '../cache-invalidator-profit-read.providers';

export {
  createPulseCacheInvalidatorRegistry,
  type PulseCacheInvalidatorInput,
  type PulseCacheInvalidatorRegistry,
} from '../cache-invalidator-pulse.providers';
