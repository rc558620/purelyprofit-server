import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  StaffRole,
  StaffStatus,
  StoreSubscriptionStatus,
  SubscriptionPlanCode,
} from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuthStaffActivationService } from './auth-staff-activation.service';
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
import { findBoundStoreRecord } from '../stores/stores-bound-store.query';
import { resolvePlanSnapshot } from '../subscriptions/subscriptions.utils';

const STORE_PROFILE_KEY_PREFIX = 'stores:profile:';

/** 门店扩展字段缓存 TTL：7 天，与门店同生命周期量级 */
const STORE_PROFILE_CACHE_TTL_SECONDS = 7 * 24 * 3600;

/**
 * 新门店默认套餐快照。
 * 直接取自套餐目录，避免此处硬编码与 SUBSCRIPTION_PLAN_CATALOG 漂移。
 */
const STARTER_PLAN = resolvePlanSnapshot(SubscriptionPlanCode.starter);

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
  private readonly logger = new Logger(AuthRegisterStoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly inviteCodeService: StoreInviteCodeService,
    private readonly authStaffActivationService: AuthStaffActivationService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateStoreDto,
  ): Promise<RegisterStoreResponseDto> {
    await this.ensureUserCanOnlyBindSingleStore(user);

    const payload = extractStoreCreatePayload(dto);
    const metadata = buildStoreProfileMetadata(payload);
    const { store, managerStaffId } = await this.prisma.$transaction(
      async (tx) => {
        const createdStore = await tx.store.create({
          data: {
            name: payload.storeName,
            address: payload.address,
            ownerId: user.id,
            businessMode: payload.businessMode,
            memberCareEnabled: payload.memberCareEnabled,
          },
          select: {
            id: true,
            name: true,
            address: true,
            businessMode: true,
            memberCareEnabled: true,
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
            planName: STARTER_PLAN.planName,
            status: StoreSubscriptionStatus.active,
            maxAccountSeats: STARTER_PLAN.maxAccountSeats,
            expiresAt: null,
          },
          update: {
            planCode: SubscriptionPlanCode.starter,
            planName: STARTER_PLAN.planName,
            status: StoreSubscriptionStatus.active,
            maxAccountSeats: STARTER_PLAN.maxAccountSeats,
            expiresAt: null,
          },
        });

        // 初始化 StoreMembershipProfile.subAccountQuota（席位上限事实源，spec 0.6）
        await tx.storeMembershipProfile.upsert({
          where: { storeId: createdStore.id },
          create: {
            storeId: createdStore.id,
            subAccountQuota: STARTER_PLAN.maxAccountSeats,
            totalPoints: 0,
            availablePoints: 0,
          },
          update: {
            subAccountQuota: STARTER_PLAN.maxAccountSeats,
          },
        });

        // 创建主账号员工记录（manager 角色，非 owner）
        // owner 角色仅限 seed-owner.mjs 脚本设置的开发者账号
        const managerStaff = await tx.staff.create({
          data: {
            storeId: createdStore.id,
            userId: user.id,
            email: user.email,
            name: user.name ?? '主账号',
            phone: user.phone,
            role: StaffRole.manager,
            permissions: [],
            status: StaffStatus.active,
            isSeatActive: true,
          },
          select: { id: true },
        });

        // 扩展字段（门店类型/地区/Logo）纳入同一事务：写入失败必须整体回滚，
        // 否则会产生「门店已建但门店类型为空」的僵尸门店——设置页该字段 disabled
        // 且提交时必填校验不通过，用户无法自行修复。
        await tx.store.update({
          where: { id: createdStore.id },
          data: {
            profileMetadata: metadata as unknown as Prisma.InputJsonValue,
          },
        });

        return { store: createdStore, managerStaffId: managerStaff.id };
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    // 为新门店生成初始邀请码（异步，不阻塞注册响应）
    void this.inviteCodeService.generateForStore(store.id).catch(() => {
      // 邀请码生成失败不影响注册主流程，可由管理员后续触发重新生成
    });

    await this.cacheStoreProfileMetadata(store.id, metadata);

    // 失效 membership 缓存，确保后续请求能读到新创建的 staff 记录
    await this.authStaffActivationService.invalidateMembershipCachesByUserId(
      user.id,
    );

    // 重新签发 JWT token，使前端无需额外请求即可获得带 currentMembership 的新 token
    const token = await this.authSessionService.signToken(user.id, {
      phone: user.phone,
      email: user.email,
      accountScope: user.accountScope ?? 'purely_profit',
      // 锚定新建门店的 manager Staff：否则多身份用户重签 token 后会被解析到其他门店身份
      ...(managerStaffId != null ? { staffId: managerStaffId } : {}),
    });

    return {
      store: buildStoreResponseDto(store, metadata),
      access_token: token.access_token,
    };
  }

  private async ensureUserCanOnlyBindSingleStore(
    user: AuthenticatedUser,
  ): Promise<void> {
    const store = await findBoundStoreRecord(this.prisma, user);

    if (store) {
      throw new ConflictException('当前账号已绑定门店，暂不支持创建多个门店');
    }
  }

  /**
   * 缓存门店扩展字段到 Redis。
   *
   * DB 事实源已在建店事务内写入（见 create），此处仅负责 best-effort 缓存，
   * 缓存失败不影响注册主流程——读取侧有 DB 优先 + Redis 兜底的恢复链路。
   */
  private async cacheStoreProfileMetadata(
    storeId: number,
    metadata: StoreProfileMetadata,
  ): Promise<void> {
    // Redis 缓存（best-effort）
    try {
      await this.redisService.set(
        `${STORE_PROFILE_KEY_PREFIX}${storeId}`,
        JSON.stringify(metadata),
        STORE_PROFILE_CACHE_TTL_SECONDS,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `保存门店 ${storeId} 扩展字段缓存失败，DB 数据不受影响：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
