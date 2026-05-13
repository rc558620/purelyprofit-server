import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  StaffStatus,
  StoreSubscriptionStatus,
  SubscriptionPlanCode,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { StoreSubscriptionResponseDto } from './dto/store-subscription-response.dto';
import { UpdateStoreSubscriptionDto } from './dto/update-store-subscription.dto';

interface PlanSnapshot {
  planName: string;
  maxAccountSeats: number;
}

@Injectable()
export class SubscriptionsService {
  private readonly planCatalog: Record<
    Exclude<SubscriptionPlanCode, 'CUSTOM'>,
    PlanSnapshot
  > = {
    STARTER: { planName: '基础版', maxAccountSeats: 1 },
    GROWTH: { planName: '成长版', maxAccountSeats: 2 },
    PRO: { planName: '专业版', maxAccountSeats: 3 },
  };

  constructor(private readonly prisma: PrismaService) {}

  async initializeStoreSubscription(
    tx: Prisma.TransactionClient,
    storeId: number,
  ): Promise<void> {
    const defaultPlan = this.resolvePlanSnapshot(SubscriptionPlanCode.STARTER);

    await tx.storeSubscription.upsert({
      where: { storeId },
      create: {
        storeId,
        planCode: SubscriptionPlanCode.STARTER,
        planName: defaultPlan.planName,
        status: StoreSubscriptionStatus.ACTIVE,
        maxAccountSeats: defaultPlan.maxAccountSeats,
      },
      update: {
        planCode: SubscriptionPlanCode.STARTER,
        planName: defaultPlan.planName,
        status: StoreSubscriptionStatus.ACTIVE,
        maxAccountSeats: defaultPlan.maxAccountSeats,
        expiresAt: null,
      },
    });

    await tx.store.update({
      where: { id: storeId },
      data: { maxAccountSeats: defaultPlan.maxAccountSeats },
    });
  }

  async getStoreSubscription(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<StoreSubscriptionResponseDto> {
    await this.ensureStoreAccessible(user, storeId);
    return this.buildSubscriptionResponse(storeId);
  }

  async updateStoreSubscription(
    user: AuthenticatedUser,
    storeId: number,
    dto: UpdateStoreSubscriptionDto,
  ): Promise<StoreSubscriptionResponseDto> {
    await this.ensureStoreOwner(user, storeId);

    return this.prisma.$transaction(async (tx) => {
      const nextPlan = this.resolvePlanSnapshot(
        dto.planCode,
        dto.maxAccountSeats,
      );
      const seatSummary = await this.getSeatSummary(storeId, tx);

      if (nextPlan.maxAccountSeats < seatSummary.activeSeatCount) {
        throw new ConflictException(
          '当前已激活账号数超过目标套餐席位，无法直接缩容',
        );
      }

      await tx.storeSubscription.upsert({
        where: { storeId },
        create: {
          storeId,
          planCode: dto.planCode,
          planName: nextPlan.planName,
          status: StoreSubscriptionStatus.ACTIVE,
          maxAccountSeats: nextPlan.maxAccountSeats,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
        update: {
          planCode: dto.planCode,
          planName: nextPlan.planName,
          status: StoreSubscriptionStatus.ACTIVE,
          maxAccountSeats: nextPlan.maxAccountSeats,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });

      await tx.store.update({
        where: { id: storeId },
        data: { maxAccountSeats: nextPlan.maxAccountSeats },
      });

      return this.buildSubscriptionResponse(storeId, tx);
    });
  }

  async getSeatSummary(
    storeId: number,
    prismaExecutor: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<{
    maxAccountSeats: number;
    activeSeatCount: number;
    availableSeatCount: number;
  }> {
    const store = await prismaExecutor.store.findUnique({
      where: { id: storeId },
      select: { id: true, maxAccountSeats: true },
    });

    if (!store) {
      throw new NotFoundException('门店不存在');
    }

    const activeSeatCount = await prismaExecutor.staff.count({
      where: {
        storeId,
        isSeatActive: true,
        status: StaffStatus.ACTIVE,
        isActive: true,
      },
    });

    return {
      maxAccountSeats: store.maxAccountSeats,
      activeSeatCount,
      availableSeatCount: Math.max(store.maxAccountSeats - activeSeatCount, 0),
    };
  }

  private async buildSubscriptionResponse(
    storeId: number,
    prismaExecutor: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<StoreSubscriptionResponseDto> {
    const subscription = await prismaExecutor.storeSubscription.findUnique({
      where: { storeId },
    });

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

  private resolvePlanSnapshot(
    planCode: SubscriptionPlanCode,
    customSeatCount?: number,
  ): PlanSnapshot {
    if (planCode === SubscriptionPlanCode.CUSTOM) {
      if (!customSeatCount || customSeatCount < 1) {
        throw new BadRequestException('自定义套餐必须提供大于等于 1 的席位数');
      }

      return {
        planName: `${customSeatCount} 账号版`,
        maxAccountSeats: customSeatCount,
      };
    }

    return this.planCatalog[planCode];
  }

  private async ensureStoreAccessible(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: {
        id: storeId,
        OR: [
          { ownerId: user.id },
          {
            staffs: {
              some: {
                isActive: true,
                status: StaffStatus.ACTIVE,
                OR: [{ userId: user.id }, { email: user.email }],
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    if (!store) {
      throw new ForbiddenException('无权查看该门店套餐信息');
    }
  }

  private async ensureStoreOwner(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, ownerId: user.id },
      select: { id: true },
    });

    if (!store) {
      throw new ForbiddenException('仅老板可调整门店套餐');
    }
  }
}
