import * as iconv from 'iconv-lite';
import { EscPosTicketBuilder } from './escpos-ticket.builder';

describe('EscPosTicketBuilder', () => {
  const builder = new EscPosTicketBuilder();

  it('小票以初始化指令开头并以半切指令结尾', () => {
    const data = builder.buildTicket({
      storeName: '测试门店',
      title: '后厨制作单',
      orderNo: 'SO-001',
      pickupNumberLabel: '005',
      tableName: 'A01',
      items: [{ name: '牛肉面', quantity: 2, specs: [{ name: '微辣' }] }],
      remark: '不要辣',
    });
    expect(data[0]).toBe(0x1b); // ESC
    expect(data[1]).toBe(0x40); // @ 初始化
    const tail = [...data.subarray(data.length - 4)];
    expect(tail).toEqual([0x1d, 0x56, 0x42, 0x00]); // GS V B 0 半切
  });

  it('默认 UTF-8 编码中文文本', () => {
    const data = builder.buildTicket({
      storeName: '',
      title: '测试小票',
      orderNo: '',
      items: [],
    });
    expect(data.toString('utf8')).toContain('测试小票');
  });

  it('gbk 编码可用 iconv 解码回原文', () => {
    const gbkBuilder = new EscPosTicketBuilder('gbk');
    const data = gbkBuilder.buildTicket({
      storeName: '测试门店',
      title: '后厨制作单',
      orderNo: 'SO-001',
      items: [],
    });
    expect(iconv.decode(data, 'gbk')).toContain('后厨制作单');
  });

  it('后厨制作单包含订单关键字段、商品明细、操作员与备注（桌台在前）', () => {
    const data = builder.buildTicket({
      variant: 'kitchen',
      storeName: '测试门店',
      title: '后厨制作单',
      orderNo: 'SO-001',
      pickupNumberLabel: '005',
      tableName: 'A01',
      items: [{ name: '牛肉面', quantity: 2, specs: [{ name: '微辣' }] }],
      operatorName: '张三',
      remark: '不要辣',
    });
    const text = data.toString('utf8');
    expect(text).toContain('后厨制作单');
    expect(text).toContain('订单号：SO-001');
    expect(text).toContain('取餐号：005');
    expect(text).toContain('桌台：A01');
    expect(text).toContain('牛肉面');
    expect(text).toContain('微辣');
    expect(text).toContain('操作员：张三');
    expect(text).toContain('备注：不要辣');
    // 备注在操作员上方，且上下带边框线
    expect(text.indexOf('备注：不要辣')).toBeLessThan(
      text.indexOf('操作员：张三'),
    );
    const kitchenRemarkIdx = text.indexOf('备注：不要辣');
    expect(text.slice(0, kitchenRemarkIdx)).toContain('----');
    expect(text.slice(kitchenRemarkIdx)).toContain('----');
    expect(text).not.toContain('应付');
    // 信息区顺序统一：订单号 → 取餐号 → 桌台 → 下单时间
    expect(text.indexOf('订单号：SO-001')).toBeLessThan(
      text.indexOf('桌台：A01'),
    );
    // 商品行展示数量、不展示金额
    // 数量段含 ESC 加粗控制字符，按分段断言
    expect(text).toContain('牛肉面 ');
    expect(text).toContain('x2');
    expect(text).not.toContain('￥');
    // 后厨单不含优惠/页脚
    expect(text).not.toContain('优惠清单');
    expect(text).not.toContain('谢谢惠顾');
  });

  it('收银台顾客票包含应付金额、操作员与结尾问候语', () => {
    const data = builder.buildTicket({
      storeName: '测试门店',
      title: '扫码点餐订单',
      orderNo: 'SO-002',
      createdAtLabel: '2026-08-17 15:45',
      items: [
        {
          name: '牛肉面',
          quantity: 1,
          unitPrice: 40,
          payableLineAmount: 40,
          specs: [{ name: '微辣' }, { name: '加豆腐' }],
        },
      ],
      payableAmount: '32.00',
      discountAmount: 8,
      discountItems: [
        { label: '满50减8', amount: -8 },
        { label: '会员等级折扣 8折', amount: -10, isStrikethrough: true },
      ],
      pointsDeductAmount: 2,
      operatorName: '张三',
      remark: '不要辣',
      footer: '谢谢惠顾，欢迎再次光临',
    });
    const text = data.toString('utf8');
    expect(text).toContain('扫码点餐订单');
    expect(text).toContain('实付：￥32.00');
    expect(text).toContain('操作员：张三');
    expect(text).toContain('谢谢惠顾，欢迎再次光临');
    // 商品明细：商品名 + 数量 + 行金额（原价口径）+ 规格顿号合并
    expect(text).toContain('商品明细');
    // 数量段含 ESC 加粗控制字符，按分段断言
    expect(text).toContain('牛肉面 ');
    expect(text).toContain('x1');
    expect(text).toContain('￥40.00');
    expect(text).toContain('微辣、加豆腐');
    // 备注保持原位（商品明细后、优惠清单前），顶部带边框线
    const remarkIdx = text.indexOf('备注：不要辣');
    expect(remarkIdx).toBeGreaterThan(text.indexOf('商品明细'));
    expect(remarkIdx).toBeLessThan(text.indexOf('优惠清单'));
    expect(text.slice(0, remarkIdx)).toContain('----');
    // 优惠清单：-￥ 前缀金额；划线（失效）项不打印；积分抵扣独立成行
    expect(text).toContain('下单时间：2026-08-17 15:45');
    expect(text).toContain('优惠清单');
    expect(text).toContain('满50减8  -￥8.00');
    expect(text).not.toContain('会员等级折扣');
    expect(text).toContain('积分抵扣  -￥2.00');
    expect(text).toContain('已优惠：¥8.00 元');
  });

  it('GBK 编码时半角 ¥ 自动替换为全角 ￥（GBK 0xA3A4），避免打印问号', () => {
    const gbkBuilder = new EscPosTicketBuilder('gbk');
    const data = gbkBuilder.buildTicket({
      storeName: '',
      title: '测试',
      orderNo: 'SO-003',
      items: [],
      payableAmount: '10.00',
    });
    const bytes = [...data];
    // GBK 解码后全角￥存在，且原始字节不出现 0x3F 问号降级
    expect(iconv.decode(data, 'gbk')).toContain('实付：￥10.00');
    expect(bytes).not.toContain(0x3f);
  });

  it('buildTest 生成测试小票', () => {
    const data = builder.buildTest('收银台测试打印');
    const text = data.toString('utf8');
    expect(text).toContain('收银台测试打印');
    expect(text).toContain('测试打印，验证 USB 链路正常');
  });
});
