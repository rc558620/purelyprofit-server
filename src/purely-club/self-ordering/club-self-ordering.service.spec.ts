import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubSelfOrderingService } from './club-self-ordering.service';

/**
 * 自助下单空间解析测试：
 * - 正常链路：返回空间会话与展示名（有区域时带「区域 · 名称」前缀）
 * - 校验分支：空令牌 / 码不存在 / 码已作废 / 空间已删除 / 餐饮门店 / 跨门店 / 未开台
 */
describe('ClubSelfOrderingService', () => {
  let service: ClubSelfOrderingService;

  const prisma = {
    spaceQrCode: { findUnique: jest.fn() },
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
    prisma.spaceQrCode.findUnique.mockResolvedValue({
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
    expect(prisma.spaceQrCode.findUnique).not.toHaveBeenCalled();
  });

  it('二维码不存在时拒绝', async () => {
    prisma.spaceQrCode.findUnique.mockResolvedValue(null);

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
});
