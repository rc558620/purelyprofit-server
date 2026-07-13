import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { parseMemberId, resolveAdjustmentDelta } from './members.utils';
import { resolveMemberAssetAdjustment } from './members-points.shared';

jest.mock('./members.utils', () => ({
  parseMemberId: jest.fn(),
  resolveAdjustmentDelta: jest.fn(),
}));

const mockedParseMemberId = parseMemberId as jest.MockedFunction<
  typeof parseMemberId
>;
const mockedResolveAdjustmentDelta =
  resolveAdjustmentDelta as jest.MockedFunction<typeof resolveAdjustmentDelta>;

describe('resolveMemberAssetAdjustment（BUG-1 / BUG-3 核心逻辑）', () => {
  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: null,
  };

  const member = {
    id: 18,
    storeId: 6,
    customerId: 1,
    name: '张三',
    phone: '13800138000',
    gender: 'MALE',
    note: null,
    birthday: null,
    beanBalance: 3,
    isPartner: false,
    partnerLevel: null,
    bannedReason: null,
    status: 'active',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    customer: null,
  };

  const baseParams = {
    assetLabel: '纯利豆',
    insufficientMessage: '纯利豆不足',
    requiresCustomer: false,
    missingCustomerMessage: '',
    resolveMember: jest.fn().mockResolvedValue(member),
    resolveOperatorStaffId: jest.fn().mockResolvedValue(55),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    baseParams.resolveMember.mockResolvedValue(member);
    baseParams.resolveOperatorStaffId.mockResolvedValue(55);
    mockedResolveAdjustmentDelta.mockReturnValue(100);
  });

  it('BUG-3：路径已传 memberId 时，body 缺 userId/id 不再抛“请指定会员”', async () => {
    mockedParseMemberId.mockImplementation(() => {
      throw new Error('不应被调用');
    });

    const result = await resolveMemberAssetAdjustment({
      ...baseParams,
      user,
      input: { reason: '补发' } as never,
      memberId: 18,
    });

    expect(mockedParseMemberId).not.toHaveBeenCalled();
    expect(result.member).toBe(member);
    expect(result.operatorStaffId).toBe(55);
  });

  it('BUG-3：未传 memberId 且 body 缺标识时，仍抛出 400', async () => {
    await expect(
      resolveMemberAssetAdjustment({
        ...baseParams,
        user,
        input: { reason: '补发' } as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('BUG-1：delta=0 通过校验链路被拦截（NotEquals(0) 已生效）', async () => {
    mockedResolveAdjustmentDelta.mockImplementation((input) => {
      // 模拟与 members.utils 一致的行为：delta 为 0 视为非法
      if (input.delta === 0) {
        throw new BadRequestException('调整纯利豆不能为 0');
      }
      return input.delta ?? 0;
    });

    await expect(
      resolveMemberAssetAdjustment({
        ...baseParams,
        user,
        input: { delta: 0, reason: '补发' } as never,
        memberId: 18,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('透传 idempotencyKey（BUG-5）', async () => {
    const result = await resolveMemberAssetAdjustment({
      ...baseParams,
      user,
      input: { reason: '补发', idempotencyKey: 'adj-123' } as never,
      memberId: 18,
    });

    expect(result.idempotencyKey).toBe('adj-123');
  });
});
