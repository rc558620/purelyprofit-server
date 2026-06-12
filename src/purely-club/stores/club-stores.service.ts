import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ClubCurrentContext } from './club-stores.types';
import type {
  ClubStoreSummaryDto,
  ClubStoresResponseDto,
  ClubSwitchCurrentStoreResponseDto,
} from './dto/club-store.dto';
import { ClubStoreAccessService } from './club-store-access.service';
import { ClubCurrentStoreContextService } from './club-current-store-context.service';
import { ClubStoreViewService } from './club-store-view.service';

@Injectable()
export class ClubStoresService {
  constructor(
    private readonly clubStoreAccessService: ClubStoreAccessService,
    private readonly clubCurrentStoreContextService: ClubCurrentStoreContextService,
    private readonly clubStoreViewService: ClubStoreViewService,
  ) {}

  async list(user: AuthenticatedUser): Promise<ClubStoresResponseDto> {
    const stores = await this.clubStoreAccessService.findAccessibleStores(user);
    if (stores.length === 0) {
      await this.clubCurrentStoreContextService.clearSelectedStoreId(user.id);
      return {
        items: [],
        currentStoreId: null,
      };
    }

    const currentStoreId =
      await this.clubCurrentStoreContextService.resolveCurrentStoreId(
        user.id,
        stores,
      );

    return {
      items: await this.clubStoreViewService.toSummaries(stores),
      currentStoreId,
    };
  }

  getCurrent(currentContext: ClubCurrentContext): Promise<ClubStoreSummaryDto> {
    return this.clubStoreViewService.toSummary(currentContext.store);
  }

  async switchCurrent(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<ClubSwitchCurrentStoreResponseDto> {
    const store = await this.clubCurrentStoreContextService.switchCurrentStore(
      user,
      storeId,
    );

    return {
      success: true,
      store: await this.clubStoreViewService.toSummary(store),
    };
  }

  async joinByScanCode(
    user: AuthenticatedUser,
    scanCode: string,
  ): Promise<ClubSwitchCurrentStoreResponseDto> {
    const targetStore = await this.clubStoreAccessService.joinStoreByScanCode(
      user,
      scanCode,
    );
    const store = await this.clubCurrentStoreContextService.switchCurrentStore(
      user,
      targetStore.id,
    );

    return {
      success: true,
      store: await this.clubStoreViewService.toSummary(store),
    };
  }

  async joinByInviteCode(
    user: AuthenticatedUser,
    inviteCode: string,
  ): Promise<ClubSwitchCurrentStoreResponseDto> {
    const targetStore = await this.clubStoreAccessService.joinStoreByInviteCode(
      user,
      inviteCode,
    );
    const store = await this.clubCurrentStoreContextService.switchCurrentStore(
      user,
      targetStore.id,
    );

    return {
      success: true,
      store: await this.clubStoreViewService.toSummary(store),
    };
  }
}
