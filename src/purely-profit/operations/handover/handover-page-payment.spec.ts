import { SalesPaymentMethod } from '@prisma/client';
import {
  attachPaymentRatios,
  mapPaymentItems,
  sumPaymentAmounts,
} from './handover-page-payment';
import type { HandoverPaymentItemDto } from './dto/handover-shared.dto';
import type { OrderItemRow } from './handover.shared';

describe('handover-page-payment', () => {
  describe('attachPaymentRatios', () => {
    const baseItems: HandoverPaymentItemDto[] = [
      {
        method: SalesPaymentMethod.wechat,
        label: '微信',
        amount: 555,
        ratio: 0,
        color: '#22c55e',
      },
      {
        method: SalesPaymentMethod.cash,
        label: '现金',
        amount: 445,
        ratio: 0,
        color: '#f59e0b',
      },
    ];

    it('应按金额占比计算 ratio（0-100 整数百分比，由 calcRatioPercent precision=0 统一计算）', () => {
      const result = attachPaymentRatios(baseItems, 1000);

      expect(result[0]!.ratio).toBe(56);
      expect(result[1]!.ratio).toBe(45);
    });

    it('总和为 0 时所有 ratio 应为 0', () => {
      const result = attachPaymentRatios(baseItems, 0);

      expect(result.every((item) => item.ratio === 0)).toBe(true);
    });

    it('负数总和时所有 ratio 应为 0', () => {
      const result = attachPaymentRatios(baseItems, -100);

      expect(result.every((item) => item.ratio === 0)).toBe(true);
    });

    it('不修改原数组，返回新数组', () => {
      const original = [...baseItems];
      const result = attachPaymentRatios(baseItems, 1000);

      expect(baseItems).toEqual(original);
      expect(result).not.toBe(baseItems);
    });

    it('应保持原数组其他字段不变', () => {
      const result = attachPaymentRatios(baseItems, 1000);

      expect(result[0]!.method).toBe('wechat');
      expect(result[0]!.label).toBe('微信');
      expect(result[0]!.amount).toBe(555);
      expect(result[0]!.color).toBe('#22c55e');
    });

    it('单项支付时 ratio 应为 100', () => {
      const singleItem: HandoverPaymentItemDto[] = [
        {
          method: SalesPaymentMethod.alipay,
          label: '支付宝',
          amount: 888,
          ratio: 0,
          color: '#1677ff',
        },
      ];

      const result = attachPaymentRatios(singleItem, 888);

      expect(result[0]!.ratio).toBe(100);
    });

    it('3 项支付精度应为整数百分比', () => {
      const items: HandoverPaymentItemDto[] = [
        {
          method: SalesPaymentMethod.wechat,
          label: '微信',
          amount: 333.33,
          ratio: 0,
          color: '#22c55e',
        },
        {
          method: SalesPaymentMethod.alipay,
          label: '支付宝',
          amount: 333.33,
          ratio: 0,
          color: '#1677ff',
        },
        {
          method: SalesPaymentMethod.cash,
          label: '现金',
          amount: 333.34,
          ratio: 0,
          color: '#f59e0b',
        },
      ];
      const total = 1000;

      const result = attachPaymentRatios(items, total);

      // calcRatioPercent(..., 0): 333.33 / 1000 * 100 = 33.333 → 整数 = 33
      expect(result[0]!.ratio).toBe(33);
      expect(result[1]!.ratio).toBe(33);
      // 333.34 / 1000 * 100 = 33.334 → 整数 = 33
      expect(result[2]!.ratio).toBe(33);
    });
  });

  describe('sumPaymentAmounts', () => {
    it('应返回所有 item.amount 之和', () => {
      const items: HandoverPaymentItemDto[] = [
        {
          method: SalesPaymentMethod.wechat,
          label: '微信',
          amount: 555,
          ratio: 0,
          color: '#22c55e',
        },
        {
          method: SalesPaymentMethod.cash,
          label: '现金',
          amount: 445,
          ratio: 0,
          color: '#f59e0b',
        },
      ];

      expect(sumPaymentAmounts(items)).toBe(1000);
    });

    it('空数组应返回 0', () => {
      expect(sumPaymentAmounts([])).toBe(0);
    });
  });

  describe('mapPaymentItems', () => {
    it('应按支付方式分组并转换单位（分→元），ratio 初始为 0', () => {
      const items: OrderItemRow[] = [
        {
          id: 1,
          productName: '拿铁',
          salePrice: 2800, // 28.00 元
          quantity: 2,
          product: null,
          order: {
            id: 1,
            date: new Date(),
            paymentMethod: SalesPaymentMethod.wechat,
            operatorNameSnapshot: '张三',
            operatorStaff: null,
            spaceSession: null,
          },
        },
        {
          id: 2,
          productName: '美式',
          salePrice: 1800, // 18.00 元
          quantity: 1,
          product: null,
          order: {
            id: 2,
            date: new Date(),
            paymentMethod: SalesPaymentMethod.cash,
            operatorNameSnapshot: '张三',
            operatorStaff: null,
            spaceSession: null,
          },
        },
      ];

      const result = mapPaymentItems(items);

      expect(result).toHaveLength(2);
      expect(result.find((item) => item.method === 'wechat')!.amount).toBe(56);
      expect(result.find((item) => item.method === 'cash')!.amount).toBe(18);
      expect(result.every((item) => item.ratio === 0)).toBe(true);
    });

    it('空数组应返回空结果', () => {
      expect(mapPaymentItems([])).toEqual([]);
    });

    it('预付款顾客支付方式为团购券时应归入团购桶而非门店结算方式', () => {
      const items: OrderItemRow[] = [
        {
          id: 1,
          productName: '预付款',
          salePrice: 5500, // 55.00 元
          quantity: 1,
          product: null,
          order: {
            id: 1,
            date: new Date(),
            paymentMethod: SalesPaymentMethod.cash, // 门店侧结算方式是现金
            operatorNameSnapshot: null,
            operatorStaff: null,
            spaceSession: {
              startTime: new Date(),
              prepaidPaymentMethod: SalesPaymentMethod.cash,
              prepaidCustomerPaymentMethod: 'groupon_voucher', // 顾客用团购券
              sessionRenewRecords: [],
              space: { name: 'A22' },
              openOperatorNameSnapshot: null,
              openOperatorStaff: null,
            },
          },
        },
      ];

      const result = mapPaymentItems(items);

      expect(result).toHaveLength(1);
      expect(result[0]!.method).toBe('groupon_voucher');
      expect(result[0]!.label).toBe('团购');
      expect(result[0]!.color).toBe('#b45309');
      expect(result[0]!.amount).toBe(55);
    });

    it('预付款顾客支付方式非团购时应正常显示门店结算方式', () => {
      const items: OrderItemRow[] = [
        {
          id: 2,
          productName: '预付款',
          salePrice: 8800, // 88.00 元
          quantity: 1,
          product: null,
          order: {
            id: 2,
            date: new Date(),
            paymentMethod: SalesPaymentMethod.wechat,
            operatorNameSnapshot: null,
            operatorStaff: null,
            spaceSession: {
              startTime: new Date(),
              prepaidPaymentMethod: SalesPaymentMethod.wechat,
              prepaidCustomerPaymentMethod: 'wechat', // 顾客用微信
              sessionRenewRecords: [],
              space: { name: 'A01' },
              openOperatorNameSnapshot: null,
              openOperatorStaff: null,
            },
          },
        },
      ];

      const result = mapPaymentItems(items);

      expect(result).toHaveLength(1);
      expect(result[0]!.method).toBe('wechat');
      expect(result[0]!.label).toBe('微信');
    });

    it('台位费顾客支付方式为团购券时应归入团购桶', () => {
      const items: OrderItemRow[] = [
        {
          id: 3,
          productName: '台位费（固定）',
          salePrice: 5500, // 55.00 元
          quantity: 1,
          product: null,
          order: {
            id: 3,
            date: new Date(),
            paymentMethod: SalesPaymentMethod.cash, // 门店侧结算方式是现金
            operatorNameSnapshot: null,
            operatorStaff: null,
            spaceSession: {
              startTime: new Date(),
              prepaidPaymentMethod: SalesPaymentMethod.cash,
              prepaidCustomerPaymentMethod: 'groupon_voucher', // 顾客用团购券开台
              sessionRenewRecords: [],
              space: { name: 'A22' },
              openOperatorNameSnapshot: null,
              openOperatorStaff: null,
            },
          },
        },
      ];

      const result = mapPaymentItems(items);

      expect(result).toHaveLength(1);
      expect(result[0]!.method).toBe('groupon_voucher');
      expect(result[0]!.label).toBe('团购');
      expect(result[0]!.color).toBe('#b45309');
      expect(result[0]!.amount).toBe(55);
    });
  });
});
