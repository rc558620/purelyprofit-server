import type { MemberCard } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { MarketingSharedService } from '../../marketing/marketing-shared.service';
import type { MemberCardDto } from './dto/member-card.response.dto';
import { MemberCardsWriteService } from './member-cards-write.service';
import type { MemberCardsService } from './member-cards.service';

const card = {
  id: 11,
  storeId: 3,
  kind: 'times',
  status: 'active',
  remainTimes: 3,
} as MemberCard;

const cardDto = { id: 11, remainTimes: 3 } as unknown as MemberCardDto;

const createService = (transaction: jest.Mock) => {
  const memberCardsService = {
    getCardOrThrow: jest.fn().mockResolvedValue(card),
    buildCardDtoById: jest.fn().mockResolvedValue(cardDto),
  } as unknown as MemberCardsService;
  const shared = {
    ensureMarketingStoreAccess: jest.fn().mockResolvedValue(undefined),
  } as unknown as MarketingSharedService;
  const prisma = { $transaction: transaction } as unknown as PrismaService;

  return new MemberCardsWriteService(prisma, shared, memberCardsService);
};

const user = {} as AuthenticatedUser;

describe('MemberCardsWriteService - 调次幂等键', () => {
  it('同一 requestId 撞唯一约束时按幂等返回当前卡，不报错', async () => {
    const transaction = jest.fn().mockRejectedValue({
      code: 'P2002',
      meta: { target: ['cardId', 'requestId'] },
    });
    const service = createService(transaction);

    await expect(
      service.adjustTimes(user, 11, {
        delta: 1,
        remark: '补 1 次',
        requestId: 'req-1',
      }),
    ).resolves.toEqual(cardDto);
  });

  it('未携带 requestId 时不吞唯一约束异常', async () => {
    const transaction = jest.fn().mockRejectedValue({ code: 'P2002' });
    const service = createService(transaction);

    await expect(
      service.adjustTimes(user, 11, { delta: 1, remark: '补 1 次' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('普通业务异常原样抛出', async () => {
    const transaction = jest.fn().mockRejectedValue(new Error('lock timeout'));
    const service = createService(transaction);

    await expect(
      service.adjustTimes(user, 11, {
        delta: 1,
        remark: '补 1 次',
        requestId: 'req-2',
      }),
    ).rejects.toThrow('lock timeout');
  });
});
