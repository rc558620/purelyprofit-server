// 结账操作员展示名口径：自动结账兜底「空间自动结账」，普通单取员工姓名快照。
import { resolveOperatorDisplayName } from './sales-record-display-name.utils';

describe('resolveOperatorDisplayName', () => {
  it('有员工姓名快照时原样返回', () => {
    expect(
      resolveOperatorDisplayName({
        operatorNameSnapshot: 'Jeffery',
        spaceSession: { autoCheckout: true },
      }),
    ).toBe('Jeffery');
  });

  it('自动结账会话（快照为空）兜底为「空间自动结账」', () => {
    expect(
      resolveOperatorDisplayName({
        operatorNameSnapshot: null,
        spaceSession: { autoCheckout: true },
      }),
    ).toBe('空间自动结账');
  });

  it('非自动结账且无档案时不产生兜底名', () => {
    expect(
      resolveOperatorDisplayName({
        operatorNameSnapshot: '',
        spaceSession: { autoCheckout: false },
      }),
    ).toBeUndefined();
    expect(resolveOperatorDisplayName({ spaceSession: null })).toBeUndefined();
  });
});
