import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreSubscriptionResponseDto } from './dto/store-subscription-response.dto';
import {
  countActiveStoreSeats,
  findStoreSeatCapacityRecord,
  findStoreSubscriptionRecord,
} from './subscriptions.query';
import { StoreSeatSummary } from './subscriptions.types';

@Injectable()
export class SubscriptionsProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getSeatSummary(
    storeId: number,
    prismaExecutor: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<StoreSeatSummary> {
    const store = await findStoreSeatCapacityRecord(prismaExecutor, storeId);

    if (!store) {
      throw new NotFoundException('门店不存在');
    }

    const activeSeatCount = await countActiveStoreSeats(
      prismaExecutor,
      storeId,
    );

    return {
      maxAccountSeats: store.maxAccountSeats,
      activeSeatCount,
      availableSeatCount: Math.max(store.maxAccountSeats - activeSeatCount, 0),
    };
  }

  async buildSubscriptionResponse(
    storeId: number,
    prismaExecutor: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<StoreSubscriptionResponseDto> {
    const subscription = await findStoreSubscriptionRecord(
      prismaExecutor,
      storeId,
    );

    if (!subscription) {
      throw new NotFoundException('门店订阅不存在');
    }

    return {
      id: subscription.id,
      storeId: subscription.storeId,
      planCode: subscription.planCode,
      planName: subscription.planName,
      status: subscription.status,
      maxAccountSeats: subscription.maxAccountSeats,
      startsAt: subscription.startsAt,
      expiresAt: subscription.expiresAt,
      seatSummary: await this.getSeatSummary(storeId, prismaExecutor),
    };
  }
}
