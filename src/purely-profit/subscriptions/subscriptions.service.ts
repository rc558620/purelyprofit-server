import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, SubscriptionPlanCode } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreSubscriptionResponseDto } from './dto/store-subscription-response.dto';
import { UpdateStoreSubscriptionDto } from './dto/update-store-subscription.dto';
import {
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
    const defaultPlan = resolvePlanSnapshot(SubscriptionPlanCode.STARTER);

    await upsertStoreSubscriptionRecord(tx, {
      storeId,
      planCode: SubscriptionPlanCode.STARTER,
      planSnapshot: defaultPlan,
      expiresAt: null,
    });

    await updateStoreSeatCapacity(tx, {
      storeId,
      maxAccountSeats: defaultPlan.maxAccountSeats,
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

    return this.prisma.$transaction(async (tx) => {
      const nextPlan = resolvePlanSnapshot(dto.planCode, dto.maxAccountSeats);
      const seatSummary = await this.subscriptionsProfileService.getSeatSummary(
        storeId,
        tx,
      );

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
      });

      await updateStoreSeatCapacity(tx, {
        storeId,
        maxAccountSeats: nextPlan.maxAccountSeats,
      });

      return this.subscriptionsProfileService.buildSubscriptionResponse(
        storeId,
        tx,
      );
    });
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
