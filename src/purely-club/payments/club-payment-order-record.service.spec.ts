import type { PrismaService } from '../../prisma/prisma.service';
import { ClubPaymentOrderRecordService } from './club-payment-order-record.service';

/**
 * 商户号定位回归：前缀直查是资金链路主路径，
 * 必须验证「正常路径只访问一张表」以及「未知前缀/前缀未命中仍能兜底扫到历史订单」。
 */
const buildPrismaTables = () => {
  const createTable = () => ({
    findUnique: jest.fn().mockResolvedValue(null),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    clubRechargeOrder: createTable(),
    clubVoucherOrder: createTable(),
    memberCardOrder: createTable(),
    scanOrderPaymentAttempt: createTable(),
    selfOrderPaymentAttempt: createTable(),
  };
};

const buildService = () => {
  const tables = buildPrismaTables();
  const service = new ClubPaymentOrderRecordService(
    tables as unknown as PrismaService,
  );
  return { tables, service };
};

describe('ClubPaymentOrderRecordService', () => {
  it('RC 前缀直查充值单：只访问一张表，不产生 5 表串行', async () => {
    const { tables, service } = buildService();
    tables.clubRechargeOrder.findUnique.mockResolvedValue({
      storeId: 7,
      spMchId: 'sp-1',
      subMchId: 'sub-1',
    });

    const result = await service.findByOrderNo('RC20261114ABC');

    expect(result).toEqual({
      kind: 'recharge',
      storeId: 7,
      spMchId: 'sp-1',
      subMchId: 'sub-1',
    });
    expect(tables.clubRechargeOrder.findUnique).toHaveBeenCalledTimes(1);
    expect(tables.clubVoucherOrder.findUnique).not.toHaveBeenCalled();
    expect(tables.memberCardOrder.findUnique).not.toHaveBeenCalled();
    expect(tables.scanOrderPaymentAttempt.findUnique).not.toHaveBeenCalled();
    expect(tables.selfOrderPaymentAttempt.findUnique).not.toHaveBeenCalled();
  });

  it('SF 前缀回读自助下单：门店取自关联订单', async () => {
    const { tables, service } = buildService();
    tables.selfOrderPaymentAttempt.findUnique.mockResolvedValue({
      spMchId: null,
      subMchId: 'sub-2',
      order: { storeId: 12 },
    });

    const result = await service.findByOrderNo('SF20261114ABC');

    expect(result).toEqual({
      kind: 'self_ordering',
      storeId: 12,
      spMchId: null,
      subMchId: 'sub-2',
    });
    expect(tables.selfOrderPaymentAttempt.findUnique).toHaveBeenCalledTimes(1);
    expect(tables.clubRechargeOrder.findUnique).not.toHaveBeenCalled();
  });

  it('未知前缀仍按原顺序兜底扫描，兼容历史单号', async () => {
    const { tables, service } = buildService();
    tables.memberCardOrder.findUnique.mockResolvedValue({
      storeId: 3,
      spMchId: null,
      subMchId: null,
    });

    const result = await service.findByOrderNo('LEGACY-001');

    expect(result?.kind).toBe('card');
    expect(tables.clubRechargeOrder.findUnique).toHaveBeenCalledTimes(1);
    expect(tables.clubVoucherOrder.findUnique).toHaveBeenCalledTimes(1);
    expect(tables.memberCardOrder.findUnique).toHaveBeenCalledTimes(1);
  });

  it('前缀对应表未命中时继续兜底，避免静默跳过资金归属校验', async () => {
    const { tables, service } = buildService();
    tables.scanOrderPaymentAttempt.findUnique.mockResolvedValue({
      storeId: 9,
      spMchId: null,
      subMchId: null,
    });

    const result = await service.findByOrderNo('VC20261114ABC');

    expect(result?.kind).toBe('scan_ordering');
    expect(tables.clubVoucherOrder.findUnique).toHaveBeenCalledTimes(1);
    expect(tables.scanOrderPaymentAttempt.findUnique).toHaveBeenCalledTimes(1);
  });

  it('落库按前缀直写单表，命中即返回对应类型', async () => {
    const { tables, service } = buildService();
    tables.clubVoucherOrder.updateMany.mockResolvedValue({ count: 1 });

    const kind = await service.persistMerchantIdentity(
      'VC20261114ABC',
      'sp-1',
      'sub-1',
    );

    expect(kind).toBe('voucher');
    expect(tables.clubVoucherOrder.updateMany).toHaveBeenCalledWith({
      where: { orderNo: 'VC20261114ABC' },
      data: { spMchId: 'sp-1', subMchId: 'sub-1' },
    });
    expect(tables.clubRechargeOrder.updateMany).not.toHaveBeenCalled();
  });

  it('全部表都未命中时返回 null 并保留告警口径', async () => {
    const { service } = buildService();

    await expect(service.findByOrderNo('RC20261114ABC')).resolves.toBeNull();
    await expect(
      service.persistMerchantIdentity('RC20261114ABC', null, null),
    ).resolves.toBeNull();
  });
});
