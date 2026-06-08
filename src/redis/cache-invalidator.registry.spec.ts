import { buildCacheInvalidatorRegistry } from './cache-invalidator.registry';

describe('buildCacheInvalidatorRegistry', () => {
  it('会按顺序合并所有 provider 返回的切片', () => {
    const firstProvider = jest.fn((input: { storeId: number }) => ({
      invalidateDashboard: () => input.storeId,
    }));
    const secondProvider = jest.fn((input: { storeId: number }) => ({
      invalidateFinance: () => input.storeId + 1,
    }));

    const registry = buildCacheInvalidatorRegistry<
      { storeId: number },
      {
        invalidateDashboard: () => number;
        invalidateFinance: () => number;
      }
    >([firstProvider, secondProvider], { storeId: 18 });

    expect(firstProvider).toHaveBeenCalledWith({ storeId: 18 });
    expect(secondProvider).toHaveBeenCalledWith({ storeId: 18 });
    expect(registry.invalidateDashboard()).toBe(18);
    expect(registry.invalidateFinance()).toBe(19);
  });

  it('后面的 provider 会覆盖同名 handler', () => {
    const registry = buildCacheInvalidatorRegistry<
      { storeId: number },
      { invalidateShared: () => string }
    >(
      [
        () => ({ invalidateShared: () => 'first' }),
        () => ({ invalidateShared: () => 'second' }),
      ],
      { storeId: 18 },
    );

    expect(registry.invalidateShared()).toBe('second');
  });

  it('允许 provider 返回空切片', () => {
    const registry = buildCacheInvalidatorRegistry<
      { storeId: number },
      { invalidateExisting: () => number }
    >(
      [
        () => ({}),
        (input: { storeId: number }) => ({
          invalidateExisting: () => input.storeId,
        }),
      ],
      { storeId: 20 },
    );

    expect(registry.invalidateExisting()).toBe(20);
  });
});
