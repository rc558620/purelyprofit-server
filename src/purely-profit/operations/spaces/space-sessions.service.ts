import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  AddSpaceSessionItemsDto,
  CheckoutSpaceSessionDto,
  CheckoutSpaceSessionPreviewDto,
  ListSpaceSessionsQueryDto,
  OpenSpaceSessionDto,
  RenewSpaceSessionDto,
  TransferSpaceSessionDto,
} from './dto/space-session.dto';
import type {
  CheckoutSpaceSessionPreviewResponseDto,
  CheckoutSpaceSessionResponseDto,
  PaginatedSpaceSessionsResponseDto,
  RenewSpaceSessionResponseDto,
  SpaceSessionResponseDto,
  TransferSpaceSessionResponseDto,
} from './dto/space-session.dto';
import type {
  LivePreviewResult,
  RenewPreviewResult,
} from './space-session-preview.service';
import { SpaceSessionCheckoutService } from './space-session-checkout.service';
import { SpaceSessionOpenService } from './space-session-open.service';
import { SpaceSessionPreviewService } from './space-session-preview.service';
import { SpaceSessionReadService } from './space-session-read.service';
import { SpaceSessionRenewService } from './space-session-renew.service';
import { SpaceSessionTransferService } from './space-session-transfer.service';
import { SpaceSessionWriteService } from './space-session-write.service';

@Injectable()
export class SpaceSessionsService {
  constructor(
    private readonly commerceAccessService: CommerceAccessService,
    private readonly readService: SpaceSessionReadService,
    private readonly checkoutService: SpaceSessionCheckoutService,
    private readonly openService: SpaceSessionOpenService,
    private readonly previewService: SpaceSessionPreviewService,
    private readonly renewService: SpaceSessionRenewService,
    private readonly transferService: SpaceSessionTransferService,
    private readonly writeService: SpaceSessionWriteService,
  ) {}

  async listStoreSpaceSessions(
    user: AuthenticatedUser,
    queryDto: ListSpaceSessionsQueryDto,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto[]> {
    return this.readService.listStoreSpaceSessions(user, queryDto, requestId);
  }

  async listStoreActiveSpaceSessions(
    user: AuthenticatedUser,
    queryDto: ListSpaceSessionsQueryDto,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto[]> {
    // P3 fix: 与 listStoreSpaceSessions 逻辑完全相同，直接委托，避免重复代码
    return this.readService.listStoreSpaceSessions(user, queryDto, requestId);
  }

  async getActiveSpaceSession(
    user: AuthenticatedUser,
    spaceId: number,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto | null> {
    return this.readService.getActiveSpaceSession(user, spaceId, requestId);
  }

  async listSpaceSessions(
    user: AuthenticatedUser,
    spaceId: number,
    queryDto: ListSpaceSessionsQueryDto,
    requestId?: string,
  ): Promise<PaginatedSpaceSessionsResponseDto> {
    return this.readService.listSpaceSessions(
      user,
      spaceId,
      queryDto,
      requestId,
    );
  }

  async getSpaceSessionDetail(
    user: AuthenticatedUser,
    sessionId: number,
    requestId?: string,
  ): Promise<SpaceSessionResponseDto> {
    return this.readService.getSpaceSessionDetail(user, sessionId, requestId);
  }

  async openSpaceSession(
    user: AuthenticatedUser,
    spaceId: number,
    dto: OpenSpaceSessionDto,
  ): Promise<SpaceSessionResponseDto> {
    return this.openService.openSession(user, spaceId, dto);
  }

  async addItemsToSpaceSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: AddSpaceSessionItemsDto,
  ): Promise<SpaceSessionResponseDto> {
    return this.writeService.addItemsToSession(user, sessionId, dto, {
      ensureCanAccessStore:
        this.commerceAccessService.ensureCanAccessStore.bind(
          this.commerceAccessService,
        ),
      findOperatorStaffIdForStore:
        this.commerceAccessService.findOperatorStaffIdForStore.bind(
          this.commerceAccessService,
        ),
    });
  }

  async renewSpaceSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: RenewSpaceSessionDto,
  ): Promise<RenewSpaceSessionResponseDto> {
    return this.renewService.renewSession(user, sessionId, dto);
  }

  async transferSpaceSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: TransferSpaceSessionDto,
  ): Promise<TransferSpaceSessionResponseDto> {
    return this.transferService.transferSession(user, sessionId, dto);
  }

  async previewSpaceSessionCheckout(
    user: AuthenticatedUser,
    sessionId: number,
    dto: CheckoutSpaceSessionPreviewDto,
  ): Promise<CheckoutSpaceSessionPreviewResponseDto> {
    return this.checkoutService.previewSpaceSessionCheckout(
      user,
      sessionId,
      dto,
    );
  }

  async getLivePreview(
    user: AuthenticatedUser,
    sessionId: number,
    requestId?: string,
  ): Promise<LivePreviewResult> {
    return this.previewService.getLivePreview(user, sessionId, requestId);
  }

  async getRenewPreview(
    user: AuthenticatedUser,
    sessionId: number,
    amount: number,
    voucherFaceAmount?: number,
    grouponCode?: string,
    grouponPlatform?: string,
    requestId?: string,
  ): Promise<RenewPreviewResult> {
    return this.previewService.getRenewPreview(
      user,
      sessionId,
      amount,
      voucherFaceAmount,
      grouponCode,
      grouponPlatform,
      requestId,
    );
  }

  async checkoutSpaceSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: CheckoutSpaceSessionDto,
  ): Promise<CheckoutSpaceSessionResponseDto> {
    return this.checkoutService.checkoutSpaceSession(user, sessionId, dto);
  }
}
