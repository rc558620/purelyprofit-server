import { PulseMembershipAdminSubAccountMutationService } from './membership-admin-sub-account-mutation.service';
import type { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import type { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import type { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';

/**
 * 子账号配额变更与「首购锁定价」的联动规则：
 * 配额归零 = 关闭子账号能力，锁定价随即失效（锁定价只在已开通子账号功能时生效），
 * 因此必须清空快照，让门店下次成交时重新锁价。
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
    resetLockedPrices: jest.fn(),
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
    lockedPriceService.resetLockedPrices.mockResolvedValue(1);
  });

  it('配额归零时清空锁定价并失效派生缓存', async () => {
    const service = createService();

    await service.updateAdminMemberSubAccountQuota(18, 101, { quota: 0 });

    expect(storeSubAccountService.updateQuota).toHaveBeenCalledWith(
      18,
      0,
      101,
      undefined,
    );
    expect(lockedPriceService.resetLockedPrices).toHaveBeenCalledWith(18);
    expect(
      mutationStateService.invalidateAdminMemberDerived,
    ).toHaveBeenCalledWith(18);
  });

  it('配额仍大于 0 时保留锁定价（续费继续按首次成交价）', async () => {
    const service = createService();

    await service.updateAdminMemberSubAccountQuota(18, 101, { quota: 2 });

    expect(storeSubAccountService.updateQuota).toHaveBeenCalledWith(
      18,
      2,
      101,
      undefined,
    );
    expect(lockedPriceService.resetLockedPrices).not.toHaveBeenCalled();
    expect(
      mutationStateService.invalidateAdminMemberDerived,
    ).toHaveBeenCalledWith(18);
  });

  it('带 roleSummary 且配额大于 0 时同步槽位并保留锁定价', async () => {
    const service = createService();

    await service.updateAdminMemberSubAccountQuota(18, 101, {
      quota: 2,
      roleSummary: [{ slot: 1, role: 'cashier' }],
    });

    expect(
      storeSubAccountService.getStoreSubAccountSummary,
    ).toHaveBeenCalledWith(18);
    expect(storeSubAccountService.updateSlot).toHaveBeenCalledTimes(1);
    expect(lockedPriceService.resetLockedPrices).not.toHaveBeenCalled();
  });

  it('配额归零时超出配额的 roleSummary 被过滤，不写入槽位', async () => {
    const service = createService();

    await service.updateAdminMemberSubAccountQuota(18, 101, {
      quota: 0,
      roleSummary: [{ slot: 1, role: 'cashier' }],
    });

    expect(storeSubAccountService.updateSlot).not.toHaveBeenCalled();
    expect(lockedPriceService.resetLockedPrices).toHaveBeenCalledWith(18);
  });
});
