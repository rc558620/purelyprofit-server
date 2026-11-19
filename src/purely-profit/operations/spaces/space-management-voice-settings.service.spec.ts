import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { SpaceManagementVoiceSettingsService } from './space-management-voice-settings.service';

describe('SpaceManagementVoiceSettingsService', () => {
  let service: SpaceManagementVoiceSettingsService;

  const prisma = {
    store: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const user = { id: 1 } as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceManagementVoiceSettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommerceAccessService, useValue: commerceAccessService },
      ],
    }).compile();

    service = module.get<SpaceManagementVoiceSettingsService>(
      SpaceManagementVoiceSettingsService,
    );
  });

  it('getForMerchant 按当前门店读取开关', async () => {
    prisma.store.findUnique.mockResolvedValue({
      spaceManagementVoiceEnabled: true,
    });

    await expect(service.getForMerchant(user)).resolves.toEqual({
      spaceManagementVoiceEnabled: true,
    });
    expect(prisma.store.findUnique).toHaveBeenCalledWith({
      where: { id: 18 },
      select: { spaceManagementVoiceEnabled: true },
    });
  });

  it('getForMerchant 门店不存在时抛 NotFound', async () => {
    prisma.store.findUnique.mockResolvedValue(null);

    await expect(service.getForMerchant(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // 回归：旧实现先 update 再 findUnique 回读，回读失败会把「已写入」误报成保存失败，
  // 前端据此回滚后界面与门店实际配置相反。现在必须只用 update 的返回结果。
  it('updateForMerchant 直接返回 update 结果，不再写后回读', async () => {
    prisma.store.update.mockResolvedValue({
      spaceManagementVoiceEnabled: true,
    });

    await expect(
      service.updateForMerchant(user, { spaceManagementVoiceEnabled: true }),
    ).resolves.toEqual({ spaceManagementVoiceEnabled: true });

    expect(prisma.store.update).toHaveBeenCalledTimes(1);
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 18 },
      data: { spaceManagementVoiceEnabled: true },
      select: { spaceManagementVoiceEnabled: true },
    });
    // 写后回读被移除：findUnique 不应被调用
    expect(prisma.store.findUnique).not.toHaveBeenCalled();
  });

  it('updateForMerchant 空更新不覆盖其他字段', async () => {
    prisma.store.update.mockResolvedValue({
      spaceManagementVoiceEnabled: false,
    });

    await expect(service.updateForMerchant(user, {})).resolves.toEqual({
      spaceManagementVoiceEnabled: false,
    });
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 18 },
      data: {},
      select: { spaceManagementVoiceEnabled: true },
    });
  });
});
