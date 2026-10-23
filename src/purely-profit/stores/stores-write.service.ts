import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { StaffRole, StaffStatus } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateStoreDto } from './dto/create-store.dto';
import {
  deriveBusinessModeFromStoreType,
  isMemberCareStoreType,
} from './store-business-mode';
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
    const metadata = buildStoreProfileMetadata(payload);
    const store = await this.prisma.$transaction(
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

        await this.subscriptionsService.initializeStoreSubscription(
          tx,
          createdStore.id,
        );

        // 与注册闭环（POST /auth/register/store）保持一致：一律建 manager。
        // owner 角色仅限 seed-owner.mjs 脚本设置的开发者账号，业务建店路径不得产出 owner，
        // 否则会绕过注册链的角色约束拿到等效 ['*'] 的权限（owner 默认权限即通配）。
        await tx.staff.create({
          data: {
            storeId: createdStore.id,
            userId: user.id,
            email: user.email,
            name: user.name ?? '主账号',
            role: StaffRole.manager,
            permissions: [],
            status: StaffStatus.active,
            isSeatActive: true,
          },
        });

        // 扩展字段纳入同一事务：写入失败必须整体回滚，避免产生
        // 「门店已建但门店类型为空」的僵尸门店（设置页该字段 disabled，用户无法自救）
        await this.storesProfileService.persistStoreProfileMetadata(
          createdStore.id,
          metadata,
          tx,
        );

        return createdStore;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
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

    // 项目规则：门店业态在注册时确定，注册后不可切换。
    // storeType 仅允许在同业态内变更（零售→服务）；跨业态（餐饮↔非餐饮）一律拒绝。
    // 否则会出现「展示类型已改但 businessMode 未变」的撕裂态：
    // 首页仍按旧业态放行功能入口，门店设置却显示新类型。
    // 另注：UpdateStoreDto 不含 businessMode，后端不接受任何业态变更入参。
    if (updatePayload.storeType !== undefined) {
      const nextBusinessMode = deriveBusinessModeFromStoreType(
        updatePayload.storeType,
      );
      if (
        nextBusinessMode !== null &&
        nextBusinessMode !== existingStore.businessMode
      ) {
        throw new BadRequestException(
          '门店业态注册后不可更改，如需变更请联系客服',
        );
      }
    }

    // 项目规则：会员护理档案档位同样在注册时确定，注册后不可切换。
    // 档位是功能可用性的硬前提（B/C 端入口与接口都按它放行），允许同业态内改写
    // 门店类型会造成「开关开着但门店已不是 SPA/养生/美容 模式」的越权态。
    if (updatePayload.storeType !== undefined) {
      const nextMemberCareEnabled = isMemberCareStoreType(
        updatePayload.storeType,
      );
      if (nextMemberCareEnabled !== existingStore.memberCareEnabled) {
        throw new BadRequestException(
          '门店类型注册后不可更改，如需变更请联系客服',
        );
      }
    }

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
              businessMode: true,
              memberCareEnabled: true,
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
