import { PulseMembershipAdminSubAccountMutationService } from './membership-admin-sub-account-mutation.service';
import type { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import type { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import type { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';

/**
 * 子账号配额变更与「成交价快照」的联动规则：
 * 配额归零 = 关闭子账号能力，此时只清空**子账号加价**（不该继续收这部分的钱），
 * 但必须保留成交总额——否则门店降级为免费、或日后重新开通时会丢掉历史议价。
 * 完整销毁成交价只能由管理端「重置成交价」显式触发。
 */
describe('PulseMembershipAdminSubAccountMutationService', () => {
  const storeSubAccountService = {
    updateQuota: jest.fn(),
    getStoreSubAccountSummary: jest.fn(),
    updateSlot: jest.fn(),
  };

  const mutationStateService = {
    invalidateAdminMemberDerived: jest.fn(),
  };

  const lockedPriceService = {
    clearSubAccountAmounts: jest.fn(),
    resetLockedPrices: jest.fn(),
    updateSubAccountSnapshot: jest.fn(),
    // 只改加价（不传数量）时用来读回原数量，避免被 updateMany 抹成 NULL
    listLockedPrices: jest.fn(),
  };

  const createService = (): PulseMembershipAdminSubAccountMutationService =>
    new PulseMembershipAdminSubAccountMutationService(
      storeSubAccountService as unknown as StoreSubAccountService,
      mutationStateService as unknown as PulseMembershipAdminMutationStateService,
      lockedPriceService as unknown as StoreMembershipLockedPriceService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    storeSubAccountService.updateQuota.mockResolvedValue(undefined);
    storeSubAccountService.getStoreSubAccountSummary.mockResolvedValue({
      quota: 0,
      usedCount: 0,
      availableCount: 0,
      roleSummary: [],
      slots: [],
    });
    mutationStateService.invalidateAdminMemberDerived.mockResolvedValue(
      undefined,
    );
    lockedPriceService.clearSubAccountAmounts.mockResolvedValue(1);
    lockedPriceService.resetLockedPrices.mockResolvedValue(1);
    lockedPriceService.updateSubAccountSnapshot.mockResolvedValue(true);
    lockedPriceService.listLockedPrices.mockResolvedValue([]);
  });

  describe('backfillSubAccountAmount', () => {
    it('补录子账号加价与数量：元字符串转分后落库', async () => {
      const service = createService();

      await service.backfillSubAccountAmount(18, {
        planId: 'yearly',
        subAccountAmountDisplay: '150',
        subAccountCount: 3,
      });

      expect(lockedPriceService.updateSubAccountSnapshot).toHaveBeenCalledWith({
        storeId: 18,
        planId: 'yearly',
        subAccountAmount: 15000,
        subAccountCount: 3,
      });
      expect(
        mutationStateService.invalidateAdminMemberDerived,
      ).toHaveBeenCalledWith(18);
    });

    it('不传加价即撤销补录：两个字段一并置空', async () => {
      const service = createService();

      await service.backfillSubAccountAmount(18, { planId: 'yearly' });

      expect(lockedPriceService.updateSubAccountSnapshot).toHaveBeenCalledWith({
        storeId: 18,
        planId: 'yearly',
        subAccountAmount: null,
        subAccountCount: null,
      });
    });

    it('加价填 0 是有效取值（不收子账号的钱），不等于撤销', async () => {
      const service = createService();

      await service.backfillSubAccountAmount(18, {
        planId: 'yearly',
        subAccountAmountDisplay: '0',
        subAccountCount: 2,
      });

      expect(lockedPriceService.updateSubAccountSnapshot).toHaveBeenCalledWith({
        storeId: 18,
        planId: 'yearly',
        subAccountAmount: 0,
        subAccountCount: 2,
      });
    });

    it('只改加价（不传数量）：保留已录入的子账号数量，不能被抹成 NULL', async () => {
      lockedPriceService.listLockedPrices.mockResolvedValue([
        { planId: 'yearly', subAccountCount: 3, subAccountAmount: 0 },
      ]);
      const service = createService();

      await service.backfillSubAccountAmount(18, {
        planId: 'yearly',
        subAccountAmountDisplay: '150',
      });

      expect(lockedPriceService.updateSubAccountSnapshot).toHaveBeenCalledWith({
        storeId: 18,
        planId: 'yearly',
        subAccountAmount: 15000,
        subAccountCount: 3,
      });
    });

    it('补录不得触碰成交总额（只调 updateSubAccountSnapshot）', async () => {
      const service = createService();

      await service.backfillSubAccountAmount(18, {
        planId: 'yearly',
        subAccountAmountDisplay: '150',
      });

      expect(lockedPriceService.resetLockedPrices).not.toHaveBeenCalled();
      expect(lockedPriceService.clearSubAccountAmounts).not.toHaveBeenCalled();
    });
  });

  it('配额归零时清空子账号加价并失效派生缓存', async () => {
    const service = createService();

    await service.updateAdminMemberSubAccountQuota(18, 101, { quota: 0 });

    expect(storeSubAccountService.updateQuota).toHaveBeenCalledWith(
      18,
      0,
      101,
      undefined,
    );
    expect(lockedPriceService.clearSubAccountAmounts).toHaveBeenCalledWith(18);
    expect(
      mutationStateService.invalidateAdminMemberDerived,
    ).toHaveBeenCalledWith(18);
  });

  it('配额归零时不得销毁成交总额（历史议价必须存活）', async () => {
    const service = createService();

    await service.updateAdminMemberSubAccountQuota(18, 101, { quota: 0 });

    expect(lockedPriceService.resetLockedPrices).not.toHaveBeenCalled();
  });

  it('配额仍大于 0 时保留子账号加价（续费继续含子账号权益）', async () => {
    const service = createService();

    await service.updateAdminMemberSubAccountQuota(18, 101, { quota: 2 });

    expect(storeSubAccountService.updateQuota).toHaveBeenCalledWith(
      18,
      2,
      101,
      undefined,
    );
    expect(lockedPriceService.clearSubAccountAmounts).not.toHaveBeenCalled();
    expect(
      mutationStateService.invalidateAdminMemberDerived,
    ).toHaveBeenCalledWith(18);
  });

  it('带 roleSummary 且配额大于 0 时同步槽位并保留子账号加价', async () => {
    const service = createService();

    await service.updateAdminMemberSubAccountQuota(18, 101, {
      quota: 2,
      roleSummary: [{ slot: 1, role: 'cashier' }],
    });

    expect(
      storeSubAccountService.getStoreSubAccountSummary,
    ).toHaveBeenCalledWith(18);
    expect(storeSubAccountService.updateSlot).toHaveBeenCalledTimes(1);
    expect(lockedPriceService.clearSubAccountAmounts).not.toHaveBeenCalled();
  });

  it('配额归零时超出配额的 roleSummary 被过滤，不写入槽位', async () => {
    const service = createService();

    await service.updateAdminMemberSubAccountQuota(18, 101, {
      quota: 0,
      roleSummary: [{ slot: 1, role: 'cashier' }],
    });

    expect(storeSubAccountService.updateSlot).not.toHaveBeenCalled();
    expect(lockedPriceService.clearSubAccountAmounts).toHaveBeenCalledWith(18);
  });
});
