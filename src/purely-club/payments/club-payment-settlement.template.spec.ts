import type { PrismaService } from '../../prisma/prisma.service';
import type { CacheInvalidatorService } from '../../redis/invalidator';
import type { ClubOrderDraftPayload } from '../orders/club-order-drafts.types';
import type { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import type { ClubPaymentLockService } from './club-payment-lock.service';
import { ClubPaymentSettlementTemplate } from './club-payment-settlement.template';

interface TestMetadata {
  productName: string;
}

/** 只用于观察模板编排顺序的最小具体子类 */
class TestSettlement extends ClubPaymentSettlementTemplate<
  TestMetadata,
  'service',
  { ok: boolean }
> {
  protected readonly memberNotFoundMessage = '会员不存在';
  public receivedRules: unknown = 'unset';

  constructor(
    prisma: PrismaService,
    drafts: ClubOrderDraftsService,
    invalidator: CacheInvalidatorService,
    lock: ClubPaymentLockService,
    private readonly calls: string[],
    private readonly rulesToLoad: unknown,
    private readonly useDefaultHook = false,
  ) {
    super(prisma, drafts, invalidator, lock);
  }

  protected assertDraftPayable(): void {
    return;
  }

  protected persistPaidDraft(
    _tx: unknown,
    _draft: ClubOrderDraftPayload<TestMetadata, 'service'>,
    rules?: unknown,
  ): Promise<void> {
    this.calls.push('persist');
    this.receivedRules = rules;
    return Promise.resolve();
  }

  protected toResponse(): { ok: boolean } {
    return { ok: true };
  }

  protected preloadSettlementRules(
    draft: ClubOrderDraftPayload<TestMetadata, 'service'>,
  ): Promise<unknown> {
    this.calls.push(this.useDefaultHook ? 'preload-default' : 'preload');
    return this.useDefaultHook
      ? super.preloadSettlementRules(draft)
      : Promise.resolve(this.rulesToLoad);
  }
}

const buildDraft = (
  status: string,
): ClubOrderDraftPayload<TestMetadata, 'service'> =>
  ({
    status,
    orderNo: 'SV-e2e-1',
    storeId: 11,
    customerId: 7,
  }) as unknown as ClubOrderDraftPayload<TestMetadata, 'service'>;

describe('ClubPaymentSettlementTemplate 事务外预加载', () => {
  const calls: string[] = [];

  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        calls.push('transaction');
        return callback({});
      },
    ),
  };

  const drafts = {
    markPaid: jest.fn((draft: unknown) => draft),
  };

  const invalidator = {
    invalidateMarketingCustomerDerived: jest.fn().mockResolvedValue(undefined),
    invalidateMembersDerived: jest.fn().mockResolvedValue(undefined),
  };

  const lock = {
    acquireLock: jest.fn().mockResolvedValue('lock-token'),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };

  const buildService = (rules: unknown, useDefault = false): TestSettlement =>
    new TestSettlement(
      prisma as unknown as PrismaService,
      drafts as unknown as ClubOrderDraftsService,
      invalidator as unknown as CacheInvalidatorService,
      lock as unknown as ClubPaymentLockService,
      calls,
      rules,
      useDefault,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
  });

  it('预加载发生在事务之前，且结果透传给落账回调', async () => {
    const rules = { tierThresholds: { gold: 100, diamond: 200 } };
    const service = buildService(rules);

    const result = await service.completePaidDraft(buildDraft('pending'));

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['preload', 'transaction', 'persist']);
    expect(service.receivedRules).toBe(rules);
  });

  it('基类默认 hook 不产生额外查询，落账回调收到 undefined', async () => {
    const service = buildService(undefined, true);

    await service.completePaidDraft(buildDraft('pending'));

    expect(calls).toEqual(['preload-default', 'transaction', 'persist']);
    expect(service.receivedRules).toBeUndefined();
  });

  it('已支付订单早返回时不做预加载、不开事务', async () => {
    const service = buildService({});

    await service.completePaidDraft(buildDraft('paid'));

    expect(calls).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('事务失败仍释放分布式锁', async () => {
    const service = buildService(undefined);
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.completePaidDraft(buildDraft('pending')),
    ).rejects.toThrow('db down');
    expect(lock.releaseLock).toHaveBeenCalledWith('SV-e2e-1', 'lock-token');
  });
});
