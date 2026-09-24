import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { hashSpaceQrToken } from '../../shared/space-qr-token-codec.utils';
import { ClubSelfOrderingService } from './club-self-ordering.service';

/**
 * 自助下单空间解析测试：
 * - 正常链路：返回空间会话与展示名（有区域时带「区域 · 名称」前缀）
 * - 校验分支：空令牌 / 码不存在 / 码已作废 / 空间已删除 / 餐饮门店 / 跨门店 / 未开台
 */
describe('ClubSelfOrderingService', () => {
  let service: ClubSelfOrderingService;

  const prisma = {
    spaceQrCode: { findFirst: jest.fn() },
    spaceSession: { findFirst: jest.fn() },
  };

  const currentStoreContext = {
    requireCurrentContext: jest.fn(),
  };

  const user = { id: 100 } as unknown as AuthenticatedUser;

  /** 构造门店上下文；businessMode 默认非餐饮 */
  const mockStoreContext = (
    storeId: number,
    businessMode: 'catering' | 'general' = 'general',
  ): void => {
    currentStoreContext.requireCurrentContext.mockResolvedValue({
      store: { id: storeId, businessMode },
    });
  };

  /** 构造空间二维码查询返回 */
  const mockQrCode = (overrides: {
    storeId: number;
    revokedAt?: Date | null;
    deletedAt?: Date | null;
    zoneName?: string | null;
  }): void => {
    prisma.spaceQrCode.findFirst.mockResolvedValue({
      storeId: overrides.storeId,
      revokedAt: overrides.revokedAt ?? null,
      space: {
        id: 7,
        name: 'A03',
        deletedAt: overrides.deletedAt ?? null,
        zone: overrides.zoneName ? { name: overrides.zoneName } : null,
      },
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStoreContext(1);
    mockQrCode({ storeId: 1 });
    prisma.spaceSession.findFirst.mockResolvedValue({ id: 42 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubSelfOrderingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ClubCurrentStoreContextService,
          useValue: currentStoreContext,
        },
      ],
    }).compile();
    service = module.get<ClubSelfOrderingService>(ClubSelfOrderingService);
  });

  it('解析成功时返回会话与空间信息', async () => {
    await expect(
      service.resolveSpace(user, { spaceToken: 'tok-1' }),
    ).resolves.toEqual({
      sessionId: 42,
      spaceId: 7,
      spaceName: 'A03',
      storeId: 1,
    });
  });

  it('空间归属区域时展示名带区域前缀', async () => {
    mockQrCode({ storeId: 1, zoneName: '二楼' });

    await expect(
      service.resolveSpace(user, { spaceToken: 'tok-1' }),
    ).resolves.toMatchObject({ spaceName: '二楼 · A03' });
  });

  it('按空间 + active 状态查询会话，未开台时拒绝', async () => {
    await service.resolveSpace(user, { spaceToken: 'tok-1' });

    expect(prisma.spaceSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 7, status: 'active' } }),
    );

    prisma.spaceSession.findFirst.mockResolvedValue(null);
    await expect(
      service.resolveSpace(user, { spaceToken: 'tok-1' }),
    ).rejects.toThrow('当前空间未开台，请联系工作人员');
  });

  it('空令牌时拒绝', async () => {
    await expect(
      service.resolveSpace(user, { spaceToken: '   ' }),
    ).rejects.toThrow('二维码无效，请扫描空间二维码');
    expect(prisma.spaceQrCode.findFirst).not.toHaveBeenCalled();
  });

  it('二维码不存在时拒绝', async () => {
    prisma.spaceQrCode.findFirst.mockResolvedValue(null);

    await expect(
      service.resolveSpace(user, { spaceToken: 'missing' }),
    ).rejects.toThrow('二维码无效，请扫描空间二维码');
  });

  it('二维码已作废时拒绝', async () => {
    mockQrCode({ storeId: 1, revokedAt: new Date() });

    await expect(
      service.resolveSpace(user, { spaceToken: 'tok-1' }),
    ).rejects.toThrow('该空间二维码已作废，请联系工作人员');
  });

  it('空间已删除时拒绝', async () => {
    mockQrCode({ storeId: 1, deletedAt: new Date() });

    await expect(
      service.resolveSpace(user, { spaceToken: 'tok-1' }),
    ).rejects.toThrow('该空间已删除，请联系工作人员');
  });

  it('餐饮门店时拒绝', async () => {
    mockStoreContext(1, 'catering');

    await expect(
      service.resolveSpace(user, { spaceToken: 'tok-1' }),
    ).rejects.toThrow('餐饮门店请使用扫码点餐');
  });

  it('二维码不属于当前门店时拒绝', async () => {
    mockQrCode({ storeId: 999 });

    await expect(
      service.resolveSpace(user, { spaceToken: 'tok-1' }),
    ).rejects.toThrow('该二维码不属于当前门店');
  });

  // 服务端兜底：前端 extractSpaceToken 本应先把 URL 还原成裸 token，
  // 但只要有入口漏掉提取（H5 / 新客户端 / 第三方），整条 URL 就会被当成 token
  // 去做等值匹配 —— 顾客看到「二维码无效」，而纸上的码其实没坏。
  describe('空间码 token 提取（服务端兜底）', () => {
    const SPACE_TOKEN = '7f1c2f52-7a1f-4a1e-9f2a-3f0a1b2c3d4e';

    const cases: Array<[string, string]> = [
      ['路径式 URL', `https://scan.purelyprofit.com/p/${SPACE_TOKEN}`],
      ['query 式 URL', `https://scan.purelyprofit.com/p?token=${SPACE_TOKEN}`],
      ['历史自定义协议', `purelyclub://space-scan?token=${SPACE_TOKEN}`],
      ['前端已提取的裸 token', SPACE_TOKEN],
    ];

    it.each(cases)('%s 都解析出同一个 token', async (_label, raw) => {
      await service.resolveSpace(user, { spaceToken: raw });

      // 只按摘要查表：库里没有明文列，也没有明文比对分支
      expect(prisma.spaceQrCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashSpaceQrToken(SPACE_TOKEN) },
        }),
      );
    });

    it('提取结果再次传入仍幂等（前端已提取过不会被改坏）', async () => {
      await service.resolveSpace(user, {
        spaceToken: `https://scan.purelyprofit.com/p/${SPACE_TOKEN}`,
      });
      const [firstCall] = prisma.spaceQrCode.findFirst.mock.calls[0] as [
        { where: { tokenHash: string } },
      ];
      expect(firstCall.where.tokenHash).toBe(hashSpaceQrToken(SPACE_TOKEN));

      prisma.spaceQrCode.findFirst.mockClear();
      await service.resolveSpace(user, { spaceToken: SPACE_TOKEN });

      const [secondCall] = prisma.spaceQrCode.findFirst.mock.calls[0] as [
        { where: { tokenHash: string } },
      ];
      expect(secondCall.where.tokenHash).toBe(hashSpaceQrToken(SPACE_TOKEN));
    });
  });
});
