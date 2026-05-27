import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PulseStoreContextService } from './pulse-store-context.service';
import {
  PULSE_TARGET_STORE_SELECT,
  type PulseStoreRow,
} from './pulse-store-context.types';

describe('PulseStoreContextService', () => {
  let service: PulseStoreContextService;

  const forbiddenMessage = '无权查看该门店，或门店不存在';

  const prismaService = {
    store: {
      findUnique: jest.fn(),
    },
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const developerUser: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    pulseMode: 'developer',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  const memberUser: AuthenticatedUser = {
    id: 102,
    email: 'merchant@example.com',
    phone: '13900139000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    pulseMode: 'normal',
    isPulseDeveloper: false,
    currentMembership: {
      staffId: 88,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseStoreContextService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<PulseStoreContextService>(PulseStoreContextService);
  });

  it('resolveTargetStore 在请求显式门店时返回 requested 并持久化选择', async () => {
    prismaService.store.findUnique.mockResolvedValue(
      createStoreRow({ id: 66, name: '纯利宝福田店', ownerId: 302 }),
    );

    await expect(
      service.resolveTargetStore(developerUser, {
        requestedStoreId: 66,
        persistResolvedSelection: true,
      }),
    ).resolves.toEqual({
      store: {
        id: 66,
        name: '纯利宝福田店',
        address: '深圳市南山区科技园',
        contactPhone: '0755-12345678',
        ownerId: 302,
        ownerName: '张三',
      },
      source: 'requested',
    });
    expect(prismaService.store.findUnique).toHaveBeenCalledWith({
      where: { id: 66 },
      select: PULSE_TARGET_STORE_SELECT,
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'pulse:selected-store:101',
      '66',
    );
  });

  it('resolveTargetStore 会优先读取已保存且可访问的 selected 门店', async () => {
    redisService.get.mockResolvedValue('18');
    prismaService.store.findUnique.mockResolvedValue(createStoreRow());

    await expect(service.resolveTargetStore(memberUser)).resolves.toEqual({
      store: {
        id: 18,
        name: '纯利宝南山店',
        address: '深圳市南山区科技园',
        contactPhone: '0755-12345678',
        ownerId: 301,
        ownerName: '张三',
      },
      source: 'selected',
    });
    expect(redisService.get).toHaveBeenCalledWith('pulse:selected-store:102');
    expect(prismaService.store.findUnique).toHaveBeenCalledWith({
      where: { id: 18 },
      select: PULSE_TARGET_STORE_SELECT,
    });
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('resolveTargetStore 会清理无访问权限的历史 selected 门店', async () => {
    redisService.get.mockResolvedValue('99');

    await expect(service.resolveTargetStore(memberUser)).resolves.toEqual({
      store: null,
      source: null,
    });
    expect(prismaService.store.findUnique).not.toHaveBeenCalled();
    expect(redisService.del).toHaveBeenCalledWith('pulse:selected-store:102');
  });

  it('resolveTargetStore 在 Redis 里是非法门店 id 时返回空结果', async () => {
    redisService.get.mockResolvedValue('invalid-store-id');

    await expect(service.resolveTargetStore(developerUser)).resolves.toEqual({
      store: null,
      source: null,
    });
    expect(prismaService.store.findUnique).not.toHaveBeenCalled();
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('resolveTargetStore 对非开发者只允许访问 currentMembership.storeId', async () => {
    prismaService.store.findUnique.mockResolvedValue(createStoreRow());

    await expect(
      service.resolveTargetStore(memberUser, { requestedStoreId: 18 }),
    ).resolves.toEqual({
      store: {
        id: 18,
        name: '纯利宝南山店',
        address: '深圳市南山区科技园',
        contactPhone: '0755-12345678',
        ownerId: 301,
        ownerName: '张三',
      },
      source: 'requested',
    });
    expect(prismaService.store.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaService.store.findUnique).toHaveBeenCalledWith({
      where: { id: 18 },
      select: PULSE_TARGET_STORE_SELECT,
    });

    prismaService.store.findUnique.mockClear();

    await expect(
      service.resolveTargetStore(memberUser, { requestedStoreId: 19 }),
    ).rejects.toThrow(forbiddenMessage);
    expect(prismaService.store.findUnique).not.toHaveBeenCalled();
  });

  it('resolveTargetStore 在 requested 门店不可访问时抛出 ForbiddenException', async () => {
    await expect(
      service.resolveTargetStore(memberUser, { requestedStoreId: 99 }),
    ).rejects.toThrow(forbiddenMessage);
    expect(prismaService.store.findUnique).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('resolveTargetStoreOrThrow 在未选中目标门店时抛出默认提示', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(
      service.resolveTargetStoreOrThrow(developerUser),
    ).rejects.toThrow('请先选择目标门店');
  });

  it('resolveTargetStoreOrThrow 会透传自定义未找到提示', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(
      service.resolveTargetStoreOrThrow(developerUser, {
        notFoundMessage: '当前未选中目标商家门店',
      }),
    ).rejects.toThrow('当前未选中目标商家门店');
  });

  it('switchTargetStore 会在可访问时写入 Redis 并返回目标门店摘要', async () => {
    prismaService.store.findUnique.mockResolvedValue(
      createStoreRow({ id: 88, name: '纯利宝宝安店', ownerId: 305 }),
    );

    await expect(service.switchTargetStore(developerUser, 88)).resolves.toEqual(
      {
        id: 88,
        name: '纯利宝宝安店',
        address: '深圳市南山区科技园',
        contactPhone: '0755-12345678',
        ownerId: 305,
        ownerName: '张三',
      },
    );
    expect(prismaService.store.findUnique).toHaveBeenCalledWith({
      where: { id: 88 },
      select: PULSE_TARGET_STORE_SELECT,
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'pulse:selected-store:101',
      '88',
    );
  });

  it('switchTargetStore 在门店不可访问时保留 ForbiddenException 语义', async () => {
    await expect(service.switchTargetStore(memberUser, 99)).rejects.toThrow(
      forbiddenMessage,
    );
    expect(prismaService.store.findUnique).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('clearSelection 会删除当前用户的已选门店 Redis key', async () => {
    redisService.del.mockResolvedValue(undefined);

    await expect(service.clearSelection(102)).resolves.toBeUndefined();
    expect(redisService.del).toHaveBeenCalledWith('pulse:selected-store:102');
  });
});

function createStoreRow(overrides?: Partial<PulseStoreRow>): PulseStoreRow {
  return {
    id: 18,
    name: '纯利宝南山店',
    address: '深圳市南山区科技园',
    contactPhone: '0755-12345678',
    ownerId: 301,
    owner: {
      name: '张老板',
      realName: '张三',
    },
    ...overrides,
  };
}
