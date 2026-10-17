import { SalesPaymentMethod } from '@prisma/client';
import {
  buildGuestPayableItems,
  buildRefundItemsFromSessions,
} from './handover-space-session-items';
import type { SettledSpaceSessionRow } from './handover.types';

const buildSession = (
  overrides: Partial<SettledSpaceSessionRow> = {},
): SettledSpaceSessionRow => ({
  id: 1,
  timeCost: 4400, // 44.00 元
  itemsCost: 5800, // 58.00 元
  prepaidAmount: 8800, // 88.00 元
  prepaidGrouponCode: '4564',
  prepaidCustomerPaymentMethod: 'groupon_voucher',
  prepaidGrouponPlatform: 'taobao',
  endTime: new Date('2026-10-17T12:00:00+08:00'),
  space: { name: 'A01' },
  saleOrder: {
    paymentMethod: SalesPaymentMethod.wechat,
    date: new Date('2026-10-17T12:00:00+08:00'),
    operatorNameSnapshot: '张三',
    operatorStaff: null,
  },
  sessionRenewRecords: [],
  ...overrides,
});

describe('handover-space-session-items', () => {
  describe('buildGuestPayableItems', () => {
    it('客人应付展示结账时的支付方式，而非开台支付方式', () => {
      // 开台：淘宝团购预付 88；消费 102；结账：微信补收 14
      const session = buildSession({
        timeCost: 4400,
        itemsCost: 5800,
        prepaidAmount: 8800,
      });

      const items = buildGuestPayableItems([session]);

      expect(items).toHaveLength(1);
      expect(items[0]!.productName).toBe('A01 · 客人应付');
      expect(items[0]!.totalRevenue).toBe(14);
      // 改前：开台为团购券 → 固定显示「淘宝团购」
      expect(items[0]!.paymentLabel).toBe('微信');
      expect(items[0]!.grouponCode).toBeNull();
    });

    it('结账使用团购券时展示团购标签与券码', () => {
      const session = buildSession({
        saleOrder: {
          paymentMethod: SalesPaymentMethod.groupon_voucher,
          date: new Date('2026-10-17T12:00:00+08:00'),
          operatorNameSnapshot: '张三',
          operatorStaff: null,
          grouponPlatform: 'meituan',
          grouponCode: '99001',
        },
      });

      const items = buildGuestPayableItems([session]);

      expect(items[0]!.paymentLabel).toBe('美团团购');
      expect(items[0]!.grouponCode).toBe('99001');
    });
  });

  describe('buildRefundItemsFromSessions', () => {
    it('退款行保持结账支付方式（现状不变）', () => {
      // 已付 88 > 消费 59.10 → 退款 28.90
      const session = buildSession({
        timeCost: 110,
        itemsCost: 5800,
        saleOrder: {
          paymentMethod: SalesPaymentMethod.wechat,
          date: new Date('2026-10-17T12:00:00+08:00'),
          operatorNameSnapshot: '张三',
          operatorStaff: null,
        },
      });

      const items = buildRefundItemsFromSessions([session]);

      expect(items).toHaveLength(1);
      expect(items[0]!.totalRevenue).toBe(-28.9);
      expect(items[0]!.paymentLabel).toBe('微信退款');
      // 退款行不展示券码
      expect(items[0]!.grouponCode).toBeNull();
    });
  });
});
