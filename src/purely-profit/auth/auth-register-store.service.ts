import { ConflictException, Injectable } from '@nestjs/common';
import {
  StaffRole,
  StaffStatus,
  StoreSubscriptionStatus,
  SubscriptionPlanCode,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { CreateStoreDto } from '../stores/dto/create-store.dto';
import {
  buildStoreResponseDto,
  type StoreProfileMetadata,
  type StoreResponseDto,
} from '../stores/dto/store-response.dto';
import {
  buildStoreProfileMetadata,
  extractStoreCreatePayload,
} from '../stores/stores.utils';

const STORE_PROFILE_KEY_PREFIX = 'stores:profile:';

/** 门店扩展字段缓存 TTL：7 天，与门店同生命周期量级 */
const STORE_PROFILE_CACHE_TTL_SECONDS = 7 * 24 * 3600;

/** STARTER 套餐快照（与 subscriptions.constants 保持一致） */
const STARTER_PLAN_SNAPSHOT = { planName: '基础版', maxAccountSeats: 1 };

/**
 * 注册闭环门店创建服务。
 *
 * 独立于 StoresModule，仅依赖全局 PrismaService / RedisService，
 * 避免 AuthModule ↔ StoresModule 循环依赖导致 NestJS 启动崩溃。
 */
@Injectable()
export class AuthRegisterStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    await this.ensureUserCanOnlyBindSingleStore(user);

    const payload = extractStoreCreatePayload(dto);
    const store = await this.prisma.$transaction(async (tx) => {
      const createdStore = await tx.store.create({
        data: {
          name: payload.storeName,
          address: payload.address,
          ownerId: user.id,
          maxAccountSeats: STARTER_PLAN_SNAPSHOT.maxAccountSeats,
        },
        select: {
          id: true,
          name: true,
          address: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // 初始化 STARTER 订阅记录
      await tx.storeSubscription.upsert({
        where: { storeId: createdStore.id },
        create: {
          storeId: createdStore.id,
          planCode: SubscriptionPlanCode.STARTER,
          planName: STARTER_PLAN_SNAPSHOT.planName,
          status: StoreSubscriptionStatus.ACTIVE,
          maxAccountSeats: STARTER_PLAN_SNAPSHOT.maxAccountSeats,
          expiresAt: null,
        },
        update: {
          planCode: SubscriptionPlanCode.STARTER,
          planName: STARTER_PLAN_SNAPSHOT.planName,
          status: StoreSubscriptionStatus.ACTIVE,
          maxAccountSeats: STARTER_PLAN_SNAPSHOT.maxAccountSeats,
          expiresAt: null,
        },
      });

      // 创建 OWNER 员工记录
      await tx.staff.create({
        data: {
          storeId: createdStore.id,
          userId: user.id,
          email: user.email,
          name: user.name ?? '老板',
          role: StaffRole.OWNER,
          permissions: ['*'],
          status: StaffStatus.ACTIVE,
          isSeatActive: true,
        },
      });

      return createdStore;
    });

    const metadata = buildStoreProfileMetadata(payload);
    await this.persistStoreProfileMetadata(store.id, metadata);

    return buildStoreResponseDto(store, metadata);
  }

  private async ensureUserCanOnlyBindSingleStore(
    user: AuthenticatedUser,
  ): Promise<void> {
    const store = await this.prisma.store.findFirst({
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
      select: { id: true },
    });

    if (store) {
      throw new ConflictException('当前账号已绑定门店，暂不支持创建多个门店');
    }
  }

  private async persistStoreProfileMetadata(
    storeId: number,
    metadata: StoreProfileMetadata,
  ): Promise<void> {
    await this.redisService.set(
      `${STORE_PROFILE_KEY_PREFIX}${storeId}`,
      JSON.stringify(metadata),
      STORE_PROFILE_CACHE_TTL_SECONDS,
    );
  }
}
