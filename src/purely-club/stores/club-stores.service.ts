import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StoresProfileService } from '../../purely-profit/stores/stores-profile.service';
import type { StoreRecordSnapshot } from '../../purely-profit/stores/dto/store-response.dto';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type {
  ClubStoreSummaryDto,
  ClubStoresResponseDto,
  ClubSwitchCurrentStoreResponseDto,
} from './dto/club-store.dto';

const CLUB_SELECTED_STORE_KEY_PREFIX = 'club:selected-store:';
const CLUB_STORE_NOT_FOUND_MESSAGE = '当前账号暂无可访问门店';
const CLUB_STORE_FORBIDDEN_MESSAGE = '无权访问该门店，或门店不存在';

@Injectable()
export class ClubStoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly storesProfileService: StoresProfileService,
  ) {}

  async list(user: AuthenticatedUser): Promise<ClubStoresResponseDto> {
    const stores = await this.findAccessibleStores(user);
    if (stores.length === 0) {
      await this.clearSelectedStoreId(user.id);
      return {
        items: [],
        currentStoreId: null,
      };
    }

    const currentStoreId = await this.resolveCurrentStoreId(user.id, stores);
    const items = await Promise.all(
      stores.map((store) => this.buildStoreSummary(store)),
    );

    return {
      items,
      currentStoreId,
    };
  }

  async getCurrent(user: AuthenticatedUser): Promise<ClubStoreSummaryDto> {
    const stores = await this.findAccessibleStores(user);
    if (stores.length === 0) {
      await this.clearSelectedStoreId(user.id);
      throw new NotFoundException(CLUB_STORE_NOT_FOUND_MESSAGE);
    }

    const currentStoreId = await this.resolveCurrentStoreId(user.id, stores);
    const currentStore =
      stores.find((store) => store.id === currentStoreId) ?? stores[0];

    return this.buildStoreSummary(currentStore);
  }

  async switchCurrent(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<ClubSwitchCurrentStoreResponseDto> {
    const store = await this.findAccessibleStoreById(user, storeId);
    if (!store) {
      throw new ForbiddenException(CLUB_STORE_FORBIDDEN_MESSAGE);
    }

    await this.persistSelectedStoreId(user.id, store.id);

    return {
      success: true,
      store: await this.buildStoreSummary(store),
    };
  }

  private async findAccessibleStores(
    user: AuthenticatedUser,
  ): Promise<StoreRecordSnapshot[]> {
    return this.prisma.store.findMany({
      where: {
        members: {
          some: {
            phone: user.phone,
            status: { not: MemberStatus.BANNED },
          },
        },
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

  private async findAccessibleStoreById(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<StoreRecordSnapshot | null> {
    return this.prisma.store.findFirst({
      where: {
        id: storeId,
        members: {
          some: {
            phone: user.phone,
            status: { not: MemberStatus.BANNED },
          },
        },
      },
      select: {
        id: true,
        name: true,
        address: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private async buildStoreSummary(
    store: StoreRecordSnapshot,
  ): Promise<ClubStoreSummaryDto> {
    const metadata = await this.storesProfileService.readStoreProfileMetadata(
      store.id,
    );

    return {
      id: store.id,
      name: store.name,
      address: store.address ?? '',
      ...(metadata.storeLogo ? { coverImage: metadata.storeLogo } : {}),
    };
  }

  private async resolveCurrentStoreId(
    userId: number,
    stores: StoreRecordSnapshot[],
  ): Promise<number> {
    const selectedStoreId = await this.readSelectedStoreId(userId);
    const hasSelectedStore =
      selectedStoreId !== null &&
      stores.some((store) => store.id === selectedStoreId);
    const resolvedStoreId = hasSelectedStore ? selectedStoreId : stores[0].id;

    if (selectedStoreId !== resolvedStoreId) {
      await this.persistSelectedStoreId(userId, resolvedStoreId);
    }

    return resolvedStoreId;
  }

  private async readSelectedStoreId(userId: number): Promise<number | null> {
    const rawStoreId = await this.redisService.get(
      this.buildSelectedStoreKey(userId),
    );
    const parsedStoreId = Number.parseInt(rawStoreId ?? '', 10);
    return Number.isNaN(parsedStoreId) ? null : parsedStoreId;
  }

  private async persistSelectedStoreId(
    userId: number,
    storeId: number,
  ): Promise<void> {
    await this.redisService.set(
      this.buildSelectedStoreKey(userId),
      `${storeId}`,
    );
  }

  private async clearSelectedStoreId(userId: number): Promise<void> {
    await this.redisService.del(this.buildSelectedStoreKey(userId));
  }

  private buildSelectedStoreKey(userId: number): string {
    return `${CLUB_SELECTED_STORE_KEY_PREFIX}${userId}`;
  }
}
