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

  it('后厨制作单包含订单关键字段、商品明细与备注', () => {
    const data = builder.buildTicket({
      storeName: '测试门店',
      title: '后厨制作单',
      orderNo: 'SO-001',
      pickupNumberLabel: '005',
      tableName: 'A01',
      items: [{ name: '牛肉面', quantity: 2, specs: [{ name: '微辣' }] }],
      remark: '不要辣',
    });
    const text = data.toString('utf8');
    expect(text).toContain('后厨制作单');
    expect(text).toContain('订单号：SO-001');
    expect(text).toContain('取餐号：005');
    expect(text).toContain('桌台：A01');
    expect(text).toContain('牛肉面 ×2');
    expect(text).toContain('微辣');
    expect(text).toContain('备注：不要辣');
    expect(text).not.toContain('应付');
  });

  it('收银台顾客票包含应付金额与结尾问候语', () => {
    const data = builder.buildTicket({
      storeName: '测试门店',
      title: '扫码点餐订单',
      orderNo: 'SO-002',
      items: [{ name: '牛肉面', quantity: 1, specs: [] }],
      payableAmount: '40.00',
      footer: '谢谢惠顾，欢迎再次光临',
    });
    const text = data.toString('utf8');
    expect(text).toContain('扫码点餐订单');
    expect(text).toContain('应付：¥40.00');
    expect(text).toContain('谢谢惠顾，欢迎再次光临');
  });

  it('buildTest 生成测试小票', () => {
    const data = builder.buildTest('收银台测试打印');
    const text = data.toString('utf8');
    expect(text).toContain('收银台测试打印');
    expect(text).toContain('测试打印，验证 USB 链路正常');
  });
});
