import { ConflictException, Injectable } from '@nestjs/common';
import { StaffRole, StaffStatus } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateStoreDto } from './dto/create-store.dto';
import type { StoreResponseDto } from './dto/store-response.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { StoresProfileService } from './stores-profile.service';
import { StoresReadService } from './stores-read.service';
import {
  buildStoreProfileMetadata,
  buildStoreProfileMetadataUpdate,
  extractStoreCreatePayload,
  extractStoreUpdatePayload,
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
    const store = await this.prisma.$transaction(
      async (tx) => {
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
            role: StaffRole.owner,
            permissions: ['*'],
            status: StaffStatus.active,
            isSeatActive: true,
          },
        });

        return createdStore;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    const metadata = buildStoreProfileMetadata(payload);
    await this.storesProfileService.persistStoreProfileMetadata(
      store.id,
      metadata,
    );

    return this.storesProfileService.buildStoreResponse(store, metadata);
  }

  async updateCurrent(
    user: AuthenticatedUser,
    dto: UpdateStoreDto,
  ): Promise<StoreResponseDto> {
    const existingStore =
      await this.storesReadService.getBoundStoreRecordOrThrow(user);

    const updatePayload = extractStoreUpdatePayload(dto);

    // 仅更新 DTO 中实际传入的数据库字段
    const storeUpdateData: Record<string, unknown> = {};
    if (updatePayload.storeName !== undefined) {
      storeUpdateData.name = updatePayload.storeName;
    }
    if (updatePayload.address !== undefined) {
      storeUpdateData.address = updatePayload.address;
    }

    const updatedStore =
      Object.keys(storeUpdateData).length > 0
        ? await this.prisma.store.update({
            where: { id: existingStore.id },
            data: storeUpdateData,
            select: {
              id: true,
              name: true,
              address: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : existingStore;

    // 增量合并 metadata：读取现有值，用 DTO 传入的字段覆盖
    const currentMetadata =
      await this.storesProfileService.readStoreProfileMetadata(
        existingStore.id,
      );
    const mergedMetadata = buildStoreProfileMetadataUpdate(
      currentMetadata,
      updatePayload,
    );
    await this.storesProfileService.persistStoreProfileMetadata(
      updatedStore.id,
      mergedMetadata,
    );

    return this.storesProfileService.buildStoreResponse(
      updatedStore,
      mergedMetadata,
    );
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
