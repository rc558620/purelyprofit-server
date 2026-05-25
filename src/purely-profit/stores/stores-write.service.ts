import { ConflictException, Injectable } from '@nestjs/common';
import { StaffRole, StaffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateStoreDto } from './dto/create-store.dto';
import type { StoreResponseDto } from './dto/store-response.dto';
import { StoresProfileService } from './stores-profile.service';
import { StoresReadService } from './stores-read.service';
import {
  buildStoreProfileMetadata,
  extractStoreCreatePayload,
} from './stores.utils';

@Injectable()
export class StoresWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly storesProfileService: StoresProfileService,
    private readonly storesReadService: StoresReadService,
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

      await this.subscriptionsService.initializeStoreSubscription(
        tx,
        createdStore.id,
      );

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
    await this.storesProfileService.persistStoreProfileMetadata(
      store.id,
      metadata,
    );

    return this.storesProfileService.buildStoreResponse(store, metadata);
  }

  async updateCurrent(
    user: AuthenticatedUser,
    dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    const existingStore =
      await this.storesReadService.getBoundStoreRecordOrThrow(user);

    const payload = extractStoreCreatePayload(dto);
    const updatedStore = await this.prisma.store.update({
      where: { id: existingStore.id },
      data: {
        name: payload.storeName,
        address: payload.address,
      },
      select: {
        id: true,
        name: true,
        address: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const metadata = buildStoreProfileMetadata(payload);
    await this.storesProfileService.persistStoreProfileMetadata(
      updatedStore.id,
      metadata,
    );

    return this.storesProfileService.buildStoreResponse(updatedStore, metadata);
  }

  private async ensureUserCanOnlyBindSingleStore(
    user: AuthenticatedUser,
  ): Promise<void> {
    const store = await this.storesReadService.findBoundStoreRecord(user);

    if (store) {
      throw new ConflictException('当前账号已绑定门店，暂不支持创建多个门店');
    }
  }
}
