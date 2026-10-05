// 客存 B 端门面服务：只做读取 / 写入 / 配置三个方向的转发，不承载任何业务规则
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CustodyPickupService } from './custody-pickup.service';
import { CustodyReadService } from './custody-read.service';
import { CustodySettingsService } from './custody-settings.service';
import { CustodyWriteService } from './custody-write.service';
import { CUSTODY_DEFAULT_LIMIT, CUSTODY_MAX_LIMIT } from './custody.constants';
import { isSupportedStatusFilter } from './custody.query';
import type {
  ConfirmPickupDto,
  CreateCustodyOrderDto,
  ListCustodyOrdersQueryDto,
  UpdateCustodySettingsDto,
  VerifyPickupCodeDto,
  VoidCustodyOrderDto,
} from './dto/custody-request.dto';
import type {
  CreateCustodyOrderResponseDto,
  CustodyOrderActionResponseDto,
  CustodyOrderDetailResponseDto,
  CustodyOrderListResponseDto,
  CustodySettingsDto,
  VerifyCustodyMemberResponseDto,
  VerifyPickupCodeResponseDto,
} from './dto/custody-response.dto';
import type { CustodyListParams } from './custody.types';

@Injectable()
export class CustodyService {
  constructor(
    private readonly custodyReadService: CustodyReadService,
    private readonly custodyWriteService: CustodyWriteService,
    private readonly custodyPickupService: CustodyPickupService,
    private readonly custodySettingsService: CustodySettingsService,
  ) {}

  listOrders(
    user: AuthenticatedUser,
    query: ListCustodyOrdersQueryDto,
  ): Promise<CustodyOrderListResponseDto> {
    return this.custodyReadService.listOrders(
      user,
      this.buildListParams(query),
    );
  }

  getOrderDetail(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<CustodyOrderDetailResponseDto> {
    return this.custodyReadService.getOrderDetail(user, orderId);
  }

  createOrder(
    user: AuthenticatedUser,
    dto: CreateCustodyOrderDto,
  ): Promise<CreateCustodyOrderResponseDto> {
    return this.custodyWriteService.createOrder(user, dto);
  }

  verifyMember(
    user: AuthenticatedUser,
    phone: string,
  ): Promise<VerifyCustodyMemberResponseDto> {
    return this.custodyWriteService.verifyMember(user, phone);
  }

  verifyPickupCode(
    user: AuthenticatedUser,
    dto: VerifyPickupCodeDto,
  ): Promise<VerifyPickupCodeResponseDto> {
    return this.custodyPickupService.verifyPickupCode(user, dto);
  }

  confirmPickup(
    user: AuthenticatedUser,
    dto: ConfirmPickupDto,
  ): Promise<CustodyOrderActionResponseDto> {
    return this.custodyPickupService.confirmPickup(user, dto);
  }

  voidOrder(
    user: AuthenticatedUser,
    orderId: number,
    dto: VoidCustodyOrderDto,
  ): Promise<CustodyOrderActionResponseDto> {
    return this.custodyWriteService.voidOrder(user, orderId, dto);
  }

  resendStoreRequest(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<CreateCustodyOrderResponseDto> {
    return this.custodyWriteService.resendStoreRequest(user, orderId);
  }

  getSettings(user: AuthenticatedUser): Promise<CustodySettingsDto> {
    return this.custodySettingsService.getSettings(user);
  }

  updateSettings(
    user: AuthenticatedUser,
    dto: UpdateCustodySettingsDto,
  ): Promise<CustodySettingsDto> {
    return this.custodySettingsService.updateSettings(user, dto);
  }

  /** 列表入参归一：门店来自登录态 membership，分页与筛选按默认口径补齐 */
  private buildListParams(
    query: ListCustodyOrdersQueryDto,
  ): Omit<CustodyListParams, 'storeId'> {
    const status =
      query.status && isSupportedStatusFilter(query.status)
        ? query.status
        : 'all';
    return {
      status,
      expiring: query.expiring === true,
      keyword: query.keyword ?? '',
      cursor: query.cursor,
      limit: Math.min(
        Math.max(query.limit ?? CUSTODY_DEFAULT_LIMIT, 1),
        CUSTODY_MAX_LIMIT,
      ),
    };
  }
}
