import { ConflictException, Injectable } from '@nestjs/common';
import {
  StaffRole,
  StaffStatus,
  StoreSubscriptionStatus,
  SubscriptionPlanCode,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuthAccountMembershipService } from './auth-account-membership.service';
import { AuthSessionService } from './auth-session.service';
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
import { StoreInviteCodeService } from '../stores/store-invite-code.service';

const STORE_PROFILE_KEY_PREFIX = 'stores:profile:';

/** 门店扩展字段缓存 TTL：7 天，与门店同生命周期量级 */
const STORE_PROFILE_CACHE_TTL_SECONDS = 7 * 24 * 3600;

/** STARTER 套餐快照（与 subscriptions.constants 保持一致） */
const STARTER_PLAN_SNAPSHOT = { planName: '基础版' };

const STARTER_SEAT_QUOTA = 1;

export class RegisterStoreResponseDto {
  store!: StoreResponseDto;
  access_token!: string;
}

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
    private readonly inviteCodeService: StoreInviteCodeService,
    private readonly authAccountMembershipService: AuthAccountMembershipService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateStoreDto,
  ): Promise<RegisterStoreResponseDto> {
    await this.ensureUserCanOnlyBindSingleStore(user);

    const payload = extractStoreCreatePayload(dto);
    const store = await this.prisma.$transaction(async (tx) => {
      const createdStore = await tx.store.create({
        data: {
          name: payload.storeName,
          address: payload.address,
          ownerId: user.id,
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
          planCode: SubscriptionPlanCode.starter,
          planName: STARTER_PLAN_SNAPSHOT.planName,
          status: StoreSubscriptionStatus.active,
          maxAccountSeats: STARTER_SEAT_QUOTA,
          expiresAt: null,
        },
        update: {
          planCode: SubscriptionPlanCode.starter,
          planName: STARTER_PLAN_SNAPSHOT.planName,
          status: StoreSubscriptionStatus.active,
          maxAccountSeats: STARTER_SEAT_QUOTA,
          expiresAt: null,
        },
      });

      // 初始化 StoreMembershipProfile.subAccountQuota（席位上限事实源，spec 0.6）
      await tx.storeMembershipProfile.upsert({
        where: { storeId: createdStore.id },
        create: {
          storeId: createdStore.id,
          subAccountQuota: STARTER_SEAT_QUOTA,
          totalPoints: 0,
          availablePoints: 0,
        },
        update: {
          subAccountQuota: STARTER_SEAT_QUOTA,
        },
      });

      // 创建 OWNER 员工记录
      await tx.staff.create({
        data: {
          storeId: createdStore.id,
          userId: user.id,
          email: user.email,
          name: user.name ?? '老板',
          role: StaffRole.owner,
          permissions: ['*'],
          status: StaffStatus.active,
          isSeatActive: true,
        },
      });

      return createdStore;
    });

    // 为新门店生成初始邀请码（异步，不阻塞注册响应）
    void this.inviteCodeService.generateForStore(store.id).catch(() => {
      // 邀请码生成失败不影响注册主流程，可由管理员后续触发重新生成
    });

    const metadata = buildStoreProfileMetadata(payload);
    await this.persistStoreProfileMetadata(store.id, metadata);

    // 失效 membership 缓存，确保后续请求能读到新创建的 staff 记录
    await this.authAccountMembershipService.invalidateMembershipCachesByUserId(
      user.id,
    );

    // 重新签发 JWT token，使前端无需额外请求即可获得带 currentMembership 的新 token
    const token = await this.authSessionService.signToken(user.id, {
      phone: user.phone,
      email: user.email,
      accountScope: user.accountScope ?? 'purely_profit',
    });

    return {
      store: buildStoreResponseDto(store, metadata),
      access_token: token.access_token,
    };
  }

  private async ensureUserCanOnlyBindSingleStore(
    user: AuthenticatedUser,
  ): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { ownerId: user.id },
          {
            staffs: {
              some: {
                isActive: true,
                status: StaffStatus.active,
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
