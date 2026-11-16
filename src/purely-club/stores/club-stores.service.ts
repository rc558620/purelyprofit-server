import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ClubCurrentContext } from './club-stores.types';
import type {
  ClubResolveScanCodeResponseDto,
  ClubStoreSummaryDto,
  ClubStoresResponseDto,
  ClubSwitchCurrentStoreResponseDto,
} from './dto/club-store.dto';
import { ClubStoreAccessService } from './club-store-access.service';
import { ClubCurrentStoreContextService } from './club-current-store-context.service';
import { ClubInviteScanResolveService } from './club-invite-scan-resolve.service';
import { ClubStoreViewService } from './club-store-view.service';

@Injectable()
export class ClubStoresService {
  constructor(
    private readonly clubStoreAccessService: ClubStoreAccessService,
    private readonly clubCurrentStoreContextService: ClubCurrentStoreContextService,
    private readonly clubStoreViewService: ClubStoreViewService,
    private readonly clubInviteScanResolveService: ClubInviteScanResolveService,
  ) {}

  async list(user: AuthenticatedUser): Promise<ClubStoresResponseDto> {
    // 门店列表与选中门店一次 MGET 读回：原实现分两次 GET 同一批 key
    const { stores, currentStoreId } =
      await this.clubCurrentStoreContextService.resolveStoresAndCurrentStoreId(
        user,
      );
    if (stores.length === 0) {
      await this.clubCurrentStoreContextService.clearSelectedStoreId(user.id);
      return {
        items: [],
        currentStoreId: null,
      };
    }

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

  resolveScanCode(
    user: AuthenticatedUser,
    scanCode: string,
  ): Promise<ClubResolveScanCodeResponseDto> {
    return this.clubInviteScanResolveService.resolveScanCode(user, scanCode);
  }
}
