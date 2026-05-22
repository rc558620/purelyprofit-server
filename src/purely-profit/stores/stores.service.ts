import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StaffRole, StaffStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { StoreResponseDto } from './dto/store-response.dto';

const STORE_PROFILE_KEY_PREFIX = 'stores:profile:';

type StoreRegionValue = string | number;

type StoreProfileMetadata = {
  storeType: string;
  region: StoreRegionValue[];
  storeLogo?: string;
};

type StoreRecordSnapshot = {
  id: number;
  name: string;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawCreateStorePayload = {
  storeName?: unknown;
  storeType?: unknown;
  region?: unknown;
  address?: unknown;
  storeLogo?: unknown;
};

type StoreCreatePayload = {
  storeName: string;
  storeType: string;
  region: StoreRegionValue[];
  address: string;
  storeLogo?: string;
};

function normalizeStoreLogo(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();
  if (normalizedValue === '' || normalizedValue.startsWith('blob:')) {
    return undefined;
  }

  return normalizedValue;
}

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly redisService: RedisService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    await this.ensureUserCanOnlyBindSingleStore(user);

    const payload = this.extractCreateStorePayload(dto);
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

    const metadata = this.buildStoreProfileMetadata(payload);
    await this.persistStoreProfileMetadata(store.id, metadata);

    return this.buildStoreResponse(store, metadata);
  }

  async getStore(user: AuthenticatedUser): Promise<StoreResponseDto> {
    const store = await this.findBoundStoreRecord(user);

    if (!store) {
      throw new NotFoundException('当前账号暂无门店');
    }

    return this.mapStoreResponse(store);
  }

  async getCurrent(user: AuthenticatedUser): Promise<StoreResponseDto> {
    return this.getStore(user);
  }

  async updateCurrent(
    user: AuthenticatedUser,
    dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    const existingStore = await this.findBoundStoreRecord(user);

    if (!existingStore) {
      throw new NotFoundException('当前账号暂无门店');
    }

    const payload = this.extractCreateStorePayload(dto);
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

    const metadata = this.buildStoreProfileMetadata(payload);
    await this.persistStoreProfileMetadata(updatedStore.id, metadata);

    return this.buildStoreResponse(updatedStore, metadata);
  }

  private async ensureUserCanOnlyBindSingleStore(
    user: AuthenticatedUser,
  ): Promise<void> {
    const store = await this.findBoundStoreRecord(user);

    if (store) {
      throw new ConflictException('当前账号已绑定门店，暂不支持创建多个门店');
    }
  }

  private findBoundStoreRecord(
    user: AuthenticatedUser,
  ): Promise<StoreRecordSnapshot | null> {
    return this.prisma.store.findFirst({
      where: {
        OR: [
          { ownerId: user.id },
          {
            staffs: {
              some: {
                isActive: true,
                status: StaffStatus.ACTIVE,
                OR: [{ userId: user.id }, { email: user.email }, { phone: user.phone }],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        address: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async mapStoreResponse(
    store: StoreRecordSnapshot,
  ): Promise<StoreResponseDto> {
    const metadata = await this.readStoreProfileMetadata(store.id);
    return this.buildStoreResponse(store, metadata);
  }

  private extractCreateStorePayload(dto: CreateStoreDto): StoreCreatePayload {
    const candidate = dto as RawCreateStorePayload;

    return {
      storeName:
        typeof candidate.storeName === 'string' ? candidate.storeName : '',
      storeType:
        typeof candidate.storeType === 'string' ? candidate.storeType : '',
      region: Array.isArray(candidate.region)
        ? candidate.region.filter(
            (item): item is StoreRegionValue =>
              typeof item === 'string' || typeof item === 'number',
          )
        : [],
      address: typeof candidate.address === 'string' ? candidate.address : '',
      storeLogo: normalizeStoreLogo(candidate.storeLogo),
    };
  }

  private buildStoreProfileMetadata(
    payload: StoreCreatePayload,
  ): StoreProfileMetadata {
    return this.normalizeStoreProfileMetadata({
      storeType: payload.storeType,
      region: payload.region,
      storeLogo: payload.storeLogo,
    });
  }

  private buildStoreResponse(
    store: StoreRecordSnapshot,
    metadata: StoreProfileMetadata,
  ): StoreResponseDto {
    return {
      id: store.id,
      storeName: store.name,
      storeType: metadata.storeType,
      region: metadata.region,
      address: store.address ?? '',
      ...(metadata.storeLogo ? { storeLogo: metadata.storeLogo } : {}),
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
    };
  }

  private normalizeStoreProfileMetadata(value: unknown): StoreProfileMetadata {
    if (!value || typeof value !== 'object') {
      return {
        storeType: '',
        region: [],
      };
    }

    const candidate = value as Partial<{
      storeType: unknown;
      region: unknown;
      storeLogo: unknown;
    }>;

    const region = Array.isArray(candidate.region)
      ? candidate.region.filter(
          (item): item is StoreRegionValue =>
            typeof item === 'string' || typeof item === 'number',
        )
      : [];

    const storeType =
      typeof candidate.storeType === 'string' ? candidate.storeType.trim() : '';
    const storeLogo = normalizeStoreLogo(candidate.storeLogo);

    return {
      storeType,
      region,
      ...(storeLogo ? { storeLogo } : {}),
    };
  }

  private async readStoreProfileMetadata(
    storeId: number,
  ): Promise<StoreProfileMetadata> {
    try {
      const raw = await this.redisService.get(this.getStoreProfileKey(storeId));
      if (!raw) {
        return this.normalizeStoreProfileMetadata(null);
      }

      const metadata = this.normalizeStoreProfileMetadata(JSON.parse(raw) as unknown);

      if (JSON.stringify(metadata) !== raw) {
        await this.persistStoreProfileMetadata(storeId, metadata);
      }

      return metadata;
    } catch (error) {
      this.logger.warn(
        `读取门店扩展字段失败，storeId=${storeId}: ${this.getErrorMessage(error)}`,
      );
      return this.normalizeStoreProfileMetadata(null);
    }
  }

  private async persistStoreProfileMetadata(
    storeId: number,
    metadata: StoreProfileMetadata,
  ): Promise<void> {
    try {
      await this.redisService.set(
        this.getStoreProfileKey(storeId),
        JSON.stringify(metadata),
      );
    } catch (error) {
      this.logger.warn(
        `保存门店扩展字段失败，storeId=${storeId}: ${this.getErrorMessage(error)}`,
      );
    }
  }

  private getStoreProfileKey(storeId: number): string {
    return `${STORE_PROFILE_KEY_PREFIX}${storeId}`;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
