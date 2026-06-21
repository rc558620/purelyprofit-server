import { ConflictException } from '@nestjs/common';
import { StaffRole, StaffStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { StoresProfileService } from './stores-profile.service';
import { StoresReadService } from './stores-read.service';
import { StoresService } from './stores.service';
import { StoresWriteService } from './stores-write.service';

describe('StoresService', () => {
  let service: StoresService;

  const prismaService = {
    store: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    staff: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const subscriptionsService = {
    initializeStoreSubscription: jest.fn(),
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
  };

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

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaService.$transaction.mockImplementation(
      (callback: (tx: typeof prismaService) => unknown) =>
        callback(prismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoresService,
        StoresProfileService,
        StoresReadService,
        StoresWriteService,
        { provide: PrismaService, useValue: prismaService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
  });

  it('当前账号已绑定门店时不允许再次创建门店', async () => {
    prismaService.store.findFirst.mockResolvedValue({
      id: 8,
      name: '已有门店',
      address: '北京市朝阳区',
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    });

    await expect(
      service.create(user, {
        storeName: '纯利优选示范店',
        storeType: '零售',
        region: ['北京市', '北京市', '朝阳区'],
        address: '北京市朝阳区望京街道 1 号',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaService.store.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { ownerId: user.id },
          {
            staffs: {
              some: {
                isActive: true,
                status: StaffStatus.ACTIVE,
                OR: [
                  { userId: user.id },
                  { email: user.email },
                  { phone: user.phone },
                ],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        address: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });

  it('CreateStoreDto 兼容前端直传的地区冗余字段', async () => {
    const dto = plainToInstance(CreateStoreDto, {
      storeName: '小嘟奶茶店',
      storeType: '其他',
      region: ['530000', '530100', '530102'],
      regionLabels: ['云南省', '昆明市', '五华区'],
      provinceCode: '530000',
      provinceName: '云南省',
      cityCode: '530100',
      cityName: '昆明市',
      districtCode: '530102',
      districtName: '五华区',
      address: '南屏街',
      storeLogo: 'blob:http://localhost:5173/test',
      latitude: '25.043844',
      longitude: '102.710002',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.latitude).toBeCloseTo(25.043844);
    expect(dto.longitude).toBeCloseTo(102.710002);
  });

  it('storeLogo 为 blob 临时地址时不会写入门店扩展字段', async () => {
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T10:30:00.000Z');

    prismaService.store.findFirst.mockResolvedValue(null);
    prismaService.store.create.mockResolvedValue({
      id: 9,
      name: '纯利优选示范店',
      address: '北京市朝阳区望京街道 1 号',
      createdAt,
      updatedAt,
    });
    subscriptionsService.initializeStoreSubscription.mockResolvedValue(
      undefined,
    );
    prismaService.staff.create.mockResolvedValue({
      id: 21,
      storeId: 9,
      userId: user.id,
      email: user.email,
      name: '老板',
      role: StaffRole.OWNER,
      permissions: ['*'],
      status: StaffStatus.ACTIVE,
      isSeatActive: true,
      isActive: true,
    });
    redisService.set.mockResolvedValue(undefined);

    const result = await service.create(user, {
      storeName: '纯利优选示范店',
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      address: '北京市朝阳区望京街道 1 号',
      storeLogo: 'blob:http://localhost:5173/test',
      latitude: 39.984104,
      longitude: 116.307503,
    });

    expect(redisService.set).toHaveBeenCalledWith(
      'stores:profile:9',
      JSON.stringify({
        storeType: '零售',
        region: ['北京市', '北京市', '朝阳区'],
        latitude: 39.984104,
        longitude: 116.307503,
      }),
    );
    expect(result).toEqual({
      id: 9,
      storeName: '纯利优选示范店',
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      address: '北京市朝阳区望京街道 1 号',
      latitude: 39.984104,
      longitude: 116.307503,
      createdAt,
      updatedAt,
    });
  });

  it('未绑定门店时可以正常创建门店并自动创建老板 staff', async () => {
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T10:30:00.000Z');

    prismaService.store.findFirst.mockResolvedValue(null);
    prismaService.store.create.mockResolvedValue({
      id: 9,
      name: '纯利优选示范店',
      address: '北京市朝阳区望京街道 1 号',
      createdAt,
      updatedAt,
    });
    subscriptionsService.initializeStoreSubscription.mockResolvedValue(
      undefined,
    );
    prismaService.staff.create.mockResolvedValue({
      id: 21,
      storeId: 9,
      userId: user.id,
      email: user.email,
      name: '老板',
      role: StaffRole.OWNER,
      permissions: ['*'],
      status: StaffStatus.ACTIVE,
      isSeatActive: true,
      isActive: true,
    });
    redisService.set.mockResolvedValue(undefined);

    const result = await service.create(user, {
      storeName: '纯利优选示范店',
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      address: '北京市朝阳区望京街道 1 号',
      storeLogo: 'data:image/png;base64,abc',
      latitude: 39.984104,
      longitude: 116.307503,
    });

    expect(prismaService.store.create).toHaveBeenCalledWith({
      data: {
        name: '纯利优选示范店',
        address: '北京市朝阳区望京街道 1 号',
        ownerId: user.id,
        maxAccountSeats: 1,
      },
      select: {
        id: true,
        name: true,
        address: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(subscriptionsService.initializeStoreSubscription).toHaveBeenCalled();
    expect(prismaService.staff.create).toHaveBeenCalledWith({
      data: {
        storeId: 9,
        userId: user.id,
        email: user.email,
        name: '老板',
        role: StaffRole.OWNER,
        permissions: ['*'],
        status: StaffStatus.ACTIVE,
        isSeatActive: true,
      },
    });
    expect(result).toEqual({
      id: 9,
      storeName: '纯利优选示范店',
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      address: '北京市朝阳区望京街道 1 号',
      storeLogo: 'data:image/png;base64,abc',
      latitude: 39.984104,
      longitude: 116.307503,
      createdAt,
      updatedAt,
    });
  });

  it('读取历史门店扩展字段时会清洗 blob 临时 Logo', async () => {
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T10:30:00.000Z');

    prismaService.store.findFirst.mockResolvedValue({
      id: 9,
      name: '纯利优选示范店',
      address: '北京市朝阳区望京街道 1 号',
      createdAt,
      updatedAt,
    });
    redisService.get.mockResolvedValue(
      JSON.stringify({
        storeType: '零售',
        region: ['北京市', '北京市', '朝阳区'],
        storeLogo: 'blob:http://localhost:5173/history-logo',
      }),
    );
    redisService.set.mockResolvedValue(undefined);

    const result = await service.getCurrent(user);

    expect(result).toEqual({
      id: 9,
      storeName: '纯利优选示范店',
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      address: '北京市朝阳区望京街道 1 号',
      createdAt,
      updatedAt,
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'stores:profile:9',
      JSON.stringify({
        storeType: '零售',
        region: ['北京市', '北京市', '朝阳区'],
      }),
    );
  });
});
