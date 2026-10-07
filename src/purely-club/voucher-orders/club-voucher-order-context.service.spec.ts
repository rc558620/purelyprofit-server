// 团购券下单上下文：顾客档案的定位必须是**本人**。
//
// 这里的断言守的是一条安全边界：释出的手机号可能被他人注册，同一门店也可能
// 存在两条同号顾客档案。一旦 `findFirst` 落到别人头上，`balance`（储值余额）
// 就是能被当场花掉的他人资产。
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubOrderPromotionsService } from '../orders/club-order-promotions.service';
import { ClubVoucherOrderContextService } from './club-voucher-order-context.service';

describe('ClubVoucherOrderContextService', () => {
  const STORE_ID = 7;
  const MY_USER_ID = 42;
  const MY_PHONE = '13800138000';

  const prismaService = {
    marketingCustomer: { findFirst: jest.fn() },
    marketingProduct: { findFirst: jest.fn() },
  };

  let service: ClubVoucherOrderContextService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubVoucherOrderContextService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubOrderPromotionsService, useValue: {} },
      ],
    }).compile();

    service = module.get(ClubVoucherOrderContextService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** resolveOwnCustomer 是私有方法，这里按实现的语义直接驱动它的查询序列 */
  const resolveOwnCustomer = (): Promise<{ id: number; balance: number } | null> =>
    (service as unknown as {
      resolveOwnCustomer: (p: {
        storeId: number;
        clubUserId: number;
        phone: string;
      }) => Promise<{ id: number; balance: number } | null>;
    }).resolveOwnCustomer({
      storeId: STORE_ID,
      clubUserId: MY_USER_ID,
      phone: MY_PHONE,
    });

  it('本人档案带 clubUserId 时优先按它命中，不看手机号', async () => {
    prismaService.marketingCustomer.findFirst.mockResolvedValueOnce({
      id: 1,
      balance: 100,
    });

    await expect(resolveOwnCustomer()).resolves.toEqual({
      id: 1,
      balance: 100,
    });

    // 锚点命中即收手，不会再退化到手机号匹配
    expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledWith({
      where: { storeId: STORE_ID, clubUserId: MY_USER_ID, deletedAt: null },
      select: { id: true, balance: true },
    });
  });

  it('他人占用同一手机号时绝不命中其档案（余额可被直接花掉）', async () => {
    prismaService.marketingCustomer.findFirst
      .mockResolvedValueOnce(null) // 本人 clubUserId 无匹配
      .mockResolvedValueOnce(null); // 手机号 + 无主限定后也无匹配

    await expect(resolveOwnCustomer()).resolves.toBeNull();

    // 关键断言：降级查询必须带 clubUserId: null 限定。
    // 少了它，同门店里属于他人的那条同号档案就会被当作自己的。
    expect(prismaService.marketingCustomer.findFirst).toHaveBeenLastCalledWith({
      where: {
        storeId: STORE_ID,
        phone: MY_PHONE,
        clubUserId: null,
        deletedAt: null,
      },
      select: { id: true, balance: true },
    });
  });

  it('历史无主档案仍可被认领（兼容早期未写 clubUserId 的数据）', async () => {
    prismaService.marketingCustomer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 9, balance: 50 });

    await expect(resolveOwnCustomer()).resolves.toEqual({
      id: 9,
      balance: 50,
    });
    expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(2);
  });
});
