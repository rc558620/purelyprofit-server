import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type {
  PulseResolvedTargetStore,
  PulseResolveTargetStoreOptions,
  PulseTargetStoreSummary,
} from './pulse-store-context.types';
import { PULSE_TARGET_STORE_SELECT } from './pulse-store-context.types';
import {
  buildPulseSelectedStoreKey,
  mapPulseStoreSummary,
} from './pulse-store-context.utils';

@Injectable()
export class PulseStoreContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async switchTargetStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<PulseTargetStoreSummary> {
    const store = await this.findAccessibleStoreById(user, storeId);

    if (!store) {
      throw new ForbiddenException('无权查看该门店，或门店不存在');
    }

    await this.persistSelectedStoreId(user.id, store.id);
    return store;
  }

  async resolveTargetStore(
    user: AuthenticatedUser,
    options?: PulseResolveTargetStoreOptions,
  ): Promise<PulseResolvedTargetStore> {
    const requestedStoreId = options?.requestedStoreId;
    if (requestedStoreId !== undefined) {
      const requestedStore = await this.findAccessibleStoreById(
        user,
        requestedStoreId,
      );
      if (!requestedStore) {
        throw new ForbiddenException('无权查看该门店，或门店不存在');
      }

      if (options?.persistResolvedSelection) {
        await this.persistSelectedStoreId(user.id, requestedStore.id);
      }

      return { store: requestedStore, source: 'requested' };
    }

    const selectedStoreId = await this.readSelectedStoreId(user.id);
    if (selectedStoreId !== null) {
      const selectedStore = await this.findAccessibleStoreById(
        user,
        selectedStoreId,
      );
      if (selectedStore) {
        return { store: selectedStore, source: 'selected' };
      }

      await this.clearSelectedStoreId(user.id);
    }

    return { store: null, source: null };
  }

  async resolveTargetStoreOrThrow(
    user: AuthenticatedUser,
    options?: PulseResolveTargetStoreOptions,
  ): Promise<PulseTargetStoreSummary> {
    const resolved = await this.resolveTargetStore(user, options);
    if (!resolved.store) {
      throw new NotFoundException(
        options?.notFoundMessage ?? '请先选择目标门店',
      );
    }

    return resolved.store;
  }

  async clearSelection(userId: number): Promise<void> {
    await this.clearSelectedStoreId(userId);
  }

  private isDeveloper(user: AuthenticatedUser): boolean {
    return user.isPulseDeveloper === true || user.pulseMode === 'developer';
  }

  private async findAccessibleStoreById(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<PulseTargetStoreSummary | null> {
    if (this.isDeveloper(user)) {
      return this.findStoreById(storeId);
    }

    if (user.currentMembership?.storeId === storeId) {
      return this.findStoreById(storeId);
    }

    return null;
  }

  private async findStoreById(
    storeId: number,
  ): Promise<PulseTargetStoreSummary | null> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: PULSE_TARGET_STORE_SELECT,
    });

    return store ? mapPulseStoreSummary(store) : null;
  }

  private async readSelectedStoreId(userId: number): Promise<number | null> {
    const rawStoreId = await this.redisService.get(
      buildPulseSelectedStoreKey(userId),
    );
    const parsedStoreId = Number.parseInt(rawStoreId ?? '', 10);
    return Number.isNaN(parsedStoreId) ? null : parsedStoreId;
  }

  private async persistSelectedStoreId(
    userId: number,
    storeId: number,
  ): Promise<void> {
    await this.redisService.set(
      buildPulseSelectedStoreKey(userId),
      String(storeId),
    );
  }

  private async clearSelectedStoreId(userId: number): Promise<void> {
    await this.redisService.del(buildPulseSelectedStoreKey(userId));
  }
}
