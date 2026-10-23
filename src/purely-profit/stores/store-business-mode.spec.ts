import {
  CATERING_STORE_TYPES,
  deriveBusinessModeFromStoreType,
  isMemberCareStoreType,
  MEMBER_CARE_STORE_TYPES,
  resolveBusinessMode,
} from './store-business-mode';

describe('store-business-mode（业态推导单一事实源）', () => {
  describe('deriveBusinessModeFromStoreType', () => {
    it('餐饮白名单内的类型推导为 catering', () => {
      CATERING_STORE_TYPES.forEach((storeType) => {
        expect(deriveBusinessModeFromStoreType(storeType)).toBe('catering');
      });
    });

    it('白名单外的类型推导为 general', () => {
      expect(deriveBusinessModeFromStoreType('零售')).toBe('general');
      expect(deriveBusinessModeFromStoreType('SPA/养生/美容/')).toBe('general');
      expect(deriveBusinessModeFromStoreType('未知业态')).toBe('general');
    });

    it('空值无法判定，返回 null', () => {
      expect(deriveBusinessModeFromStoreType('')).toBeNull();
      expect(deriveBusinessModeFromStoreType('   ')).toBeNull();
      expect(deriveBusinessModeFromStoreType(undefined)).toBeNull();
      expect(deriveBusinessModeFromStoreType(null)).toBeNull();
      expect(deriveBusinessModeFromStoreType(123)).toBeNull();
    });

    it('容忍首尾空白', () => {
      expect(deriveBusinessModeFromStoreType(' 餐饮 ')).toBe('catering');
    });
  });

  describe('resolveBusinessMode', () => {
    it('storeType 优先于 businessMode（避免前端传参错误污染业态）', () => {
      expect(resolveBusinessMode('零售', 'catering')).toBe('general');
      expect(resolveBusinessMode('餐饮', 'general')).toBe('catering');
    });

    it('storeType 为空时回退到 businessMode', () => {
      expect(resolveBusinessMode('', 'catering')).toBe('catering');
      expect(resolveBusinessMode(undefined, 'general')).toBe('general');
    });

    it('两者都不可用时兜底为 general（最小权限）', () => {
      expect(resolveBusinessMode('', undefined)).toBe('general');
      expect(resolveBusinessMode(undefined, 'illegal')).toBe('general');
    });
  });

  describe('isMemberCareStoreType（会员护理档案档位）', () => {
    it('「SPA/养生/美容/」模式启用会员护理档案', () => {
      MEMBER_CARE_STORE_TYPES.forEach((storeType) => {
        expect(isMemberCareStoreType(storeType)).toBe(true);
      });
    });

    it('其它门店类型一律不启用（非餐饮细分类型也不启用）', () => {
      expect(isMemberCareStoreType('零售')).toBe(false);
      expect(isMemberCareStoreType('服务')).toBe(false);
      expect(isMemberCareStoreType('便利店')).toBe(false);
      expect(isMemberCareStoreType('餐饮')).toBe(false);
      expect(isMemberCareStoreType('其他')).toBe(false);
      // 旧的单一「养生」文案已更名为「SPA/养生/美容/」，不再单独启用
      expect(isMemberCareStoreType('养生')).toBe(false);
    });

    it('容忍首尾空白与结尾斜杠差异', () => {
      expect(isMemberCareStoreType(' SPA/养生/美容/ ')).toBe(true);
      expect(isMemberCareStoreType('SPA/养生/美容')).toBe(true);
    });

    it('空值与非字符串一律不启用', () => {
      expect(isMemberCareStoreType('')).toBe(false);
      expect(isMemberCareStoreType('   ')).toBe(false);
      expect(isMemberCareStoreType(undefined)).toBe(false);
      expect(isMemberCareStoreType(null)).toBe(false);
      expect(isMemberCareStoreType(123)).toBe(false);
    });
  });
});
