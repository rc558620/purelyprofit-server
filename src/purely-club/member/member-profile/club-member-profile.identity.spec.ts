import type { PrismaService } from '../../../prisma/prisma.service';
import type { RedisService } from '../../../redis/redis.service';
import { ClubMemberProfileService } from './club-member-profile.service';

interface IdentityLookupMethods {
  findCurrentMember: (
    storeId: number,
    clubUserId: number,
    phone: string,
  ) => Promise<unknown>;
  findMarketingCustomer: (
    storeId: number,
    clubUserId: number,
    phone: string,
  ) => Promise<unknown>;
}

const STORE_ID = 11;
const CLUB_USER_ID = 201;
const PHONE = '13800138000';

describe('ClubMemberProfileService · 档案两段锚定与签到口径一致', () => {
  let service: ClubMemberProfileService;
  let prisma: {
    member: { findFirst: jest.Mock };
    marketingCustomer: { findFirst: jest.Mock };
  };
  let lookup: IdentityLookupMethods;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      member: { findFirst: jest.fn() },
      marketingCustomer: { findFirst: jest.fn() },
    };
    service = new ClubMemberProfileService(
      prisma as unknown as PrismaService,
      {} as RedisService,
    );
    lookup = service as unknown as IdentityLookupMethods;
  });

  it('顾客档案优先命中当前用户绑定记录，不再用 OR 让无主档案随机胜出', async () => {
    prisma.marketingCustomer.findFirst.mockResolvedValue({ id: 55 });

    await lookup.findMarketingCustomer(STORE_ID, CLUB_USER_ID, PHONE);

    expect(prisma.marketingCustomer.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.marketingCustomer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: STORE_ID, clubUserId: CLUB_USER_ID, deletedAt: null },
      }),
    );
  });

  it('绑定记录不存在时才回落「手机号 + clubUserId:null」无主档案', async () => {
    prisma.marketingCustomer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 77 });

    const result = await lookup.findMarketingCustomer(
      STORE_ID,
      CLUB_USER_ID,
      PHONE,
    );

    expect(result).toEqual({ id: 77 });
    expect(prisma.marketingCustomer.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          storeId: STORE_ID,
          phone: PHONE,
          clubUserId: null,
          deletedAt: null,
        },
      }),
    );
  });

  it('会员记录同样按「先绑定、后无主」两段锚定，避免与顾客档案错位', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: 9, createdAt: new Date() });

    await lookup.findCurrentMember(STORE_ID, CLUB_USER_ID, PHONE);

    expect(prisma.member.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.member.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: STORE_ID,
          clubUserId: CLUB_USER_ID,
          deletedAt: null,
        }),
      }),
    );
  });
});
