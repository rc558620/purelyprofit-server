import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubStoreAccessService } from './club-store-access.service';
import type {
  ClubAccessibleStoreRecord,
  ClubCurrentContext,
} from './club-stores.types';

const CLUB_SELECTED_STORE_KEY_PREFIX = 'club:selected-store:';
const CLUB_STORE_NOT_FOUND_MESSAGE = '当前账号暂无可访问门店';
const CLUB_STORE_FORBIDDEN_MESSAGE = '无权访问该门店，或门店不存在';

@Injectable()
export class ClubCurrentStoreContextService {
  constructor(
    private readonly redisService: RedisService,
    private readonly clubStoreAccessService: ClubStoreAccessService,
  ) {}

  async resolveCurrentContext(
    user: AuthenticatedUser,
  ): Promise<ClubCurrentContext> {
    const store = await this.getCurrentStore(user);
    return {
      user,
      store,
    };
  }

  async requireCurrentContext(
    user: AuthenticatedUser,
    requestedStoreId?: number,
  ): Promise<ClubCurrentContext> {
    const currentContext = await this.resolveCurrentContext(user);
    if (
      requestedStoreId != null &&
      currentContext.store.id !== requestedStoreId
    ) {
      throw new BadRequestException('当前门店已切换，请刷新页面后重试');
    }

    return currentContext;
  }

  async getCurrentStore(
    user: AuthenticatedUser,
  ): Promise<ClubAccessibleStoreRecord> {
    const stores = await this.clubStoreAccessService.findAccessibleStores(user);
    if (stores.length === 0) {
      await this.clearSelectedStoreId(user.id);
      throw new NotFoundException(CLUB_STORE_NOT_FOUND_MESSAGE);
    }

    const currentStoreId = await this.resolveCurrentStoreId(user.id, stores);
    return stores.find((store) => store.id === currentStoreId) ?? stores[0];
  }

  async switchCurrentStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<ClubAccessibleStoreRecord> {
    const store = await this.clubStoreAccessService.findAccessibleStoreById(
      user,
      storeId,
    );
    if (!store) {
      throw new ForbiddenException(CLUB_STORE_FORBIDDEN_MESSAGE);
    }

    await this.persistSelectedStoreId(user.id, store.id);
    return store;
  }

  async resolveCurrentStoreId(
    userId: number,
    stores: ClubAccessibleStoreRecord[],
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

  async clearSelectedStoreId(userId: number): Promise<void> {
    await this.redisService.del(this.buildSelectedStoreKey(userId));
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

  private buildSelectedStoreKey(userId: number): string {
    return `${CLUB_SELECTED_STORE_KEY_PREFIX}${userId}`;
  }
}
