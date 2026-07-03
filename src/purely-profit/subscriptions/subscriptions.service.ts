import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  StoreSubscriptionStatus,
  SubscriptionPlanCode,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { StoreSubscriptionResponseDto } from './dto/store-subscription-response.dto';
import { UpdateStoreSubscriptionDto } from './dto/update-store-subscription.dto';
import {
  findStoreSubscriptionRecord,
  updateStoreSeatCapacity,
  upsertStoreSubscriptionRecord,
} from './subscriptions.query';
import { SubscriptionsAccessService } from './subscriptions-access.service';
import { SubscriptionsProfileService } from './subscriptions-profile.service';
import { StoreSeatSummary } from './subscriptions.types';
import { resolvePlanSnapshot } from './subscriptions.utils';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsAccessService: SubscriptionsAccessService,
    private readonly subscriptionsProfileService: SubscriptionsProfileService,
  ) {}

  async initializeStoreSubscription(
    tx: Prisma.TransactionClient,
    storeId: number,
  ): Promise<void> {
    const defaultPlan = resolvePlanSnapshot(SubscriptionPlanCode.starter);

    await upsertStoreSubscriptionRecord(tx, {
      storeId,
      planCode: SubscriptionPlanCode.starter,
      planSnapshot: defaultPlan,
      expiresAt: null,
    });

    await updateStoreSeatCapacity(tx, {
      storeId,
      seatQuota: defaultPlan.maxAccountSeats,
    });
  }

  async getStoreSubscription(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<StoreSubscriptionResponseDto> {
    await this.subscriptionsAccessService.ensureStoreAccessible(user, storeId);
    return this.subscriptionsProfileService.buildSubscriptionResponse(storeId);
  }

  async updateStoreSubscription(
    user: AuthenticatedUser,
    storeId: number,
    dto: UpdateStoreSubscriptionDto,
  ): Promise<StoreSubscriptionResponseDto> {
    await this.subscriptionsAccessService.ensureStoreOwner(user, storeId);

    return this.prisma.$transaction(
      async (tx) => {
        const currentSubscription = await findStoreSubscriptionRecord(
          tx,
          storeId,
        );

        if (!currentSubscription) {
          throw new BadRequestException('门店订阅记录不存在，请先初始化');
        }

        this.validateSubscriptionTransition(
          currentSubscription.status,
          dto.planCode,
        );

        const nextPlan = resolvePlanSnapshot(dto.planCode, dto.maxAccountSeats);
        const seatSummary =
          await this.subscriptionsProfileService.getSeatSummary(storeId, tx);

        if (nextPlan.maxAccountSeats < seatSummary.activeSeatCount) {
          throw new ConflictException(
            '当前已激活账号数超过目标套餐席位，无法直接缩容',
          );
        }

        const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

        await upsertStoreSubscriptionRecord(tx, {
          storeId,
          planCode: dto.planCode,
          planSnapshot: nextPlan,
          expiresAt,
          targetStatus: StoreSubscriptionStatus.active,
        });

        await updateStoreSeatCapacity(tx, {
          storeId,
          seatQuota: nextPlan.maxAccountSeats,
        });

        return this.subscriptionsProfileService.buildSubscriptionResponse(
          storeId,
          tx,
        );
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
  }

  /** 校验订阅状态流转合法性 */
  private validateSubscriptionTransition(
    currentStatus: StoreSubscriptionStatus,
    _targetPlanCode: SubscriptionPlanCode,
  ): void {
    void _targetPlanCode; // 预留参数，后续会用于校验目标套餐是否为当前套餐的合法变更目标
    if (currentStatus === StoreSubscriptionStatus.cancelled) {
      throw new BadRequestException(
        '订阅已取消，无法直接变更套餐，请联系客服重新开通',
      );
    }

    // EXPIRED 状态允许续费/升级（变更套餐即视为重新激活）
    // ACTIVE 状态允许升降级
  }

  getSeatSummary(
    storeId: number,
    prismaExecutor: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<StoreSeatSummary> {
    return this.subscriptionsProfileService.getSeatSummary(
      storeId,
      prismaExecutor,
    );
  }
}
