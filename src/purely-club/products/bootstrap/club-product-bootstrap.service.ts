/**
 * 服务详情页首屏聚合服务。
 *
 * 把 serviceDetail 页面进场所需的五份数据合成一次往返：
 * 商品详情 / 会员账户 / 当前门店 ID / 积分规则 / 初始规格的价格预计算。
 *
 * 降级口径与页面原先的并发请求完全一致（页面此前是逐个 catch 的）：
 * - 商品详情：失败即整页错误态（含「商品不存在」，与 GET /club/products/:id 同口径）；
 * - 会员账户 / 积分规则 / 预计算：失败降级为 null，页面按无账户 / 无比例 / 无 preview 展示。
 *
 * 初始规格固定为「1 件 + 商品配置人数」，与前端进入页面时的默认选择对齐；
 * 预计算恒定以 usePoints=true 取价——展示的是「积分最多可抵扣多少」，与开关状态无关。
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  ClubMemberAccountDto,
  ClubPointsRatioDto,
} from '../../member/dto/club-member-account.dto';
import { ClubMemberService } from '../../member/club-member.service';
import { ClubOrderPreviewService } from '../../orders/club-order-preview.service';
import type { ClubServiceOrderPreviewResponseDto } from '../../orders/dto/club-order.dto';
import type { ClubProductDto } from '../dto/club-product.dto';
import { ClubProductsService } from '../club-products.service';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import { ClubVoucherOrdersService } from '../../voucher-orders/club-voucher-orders.service';
import type { ClubVoucherOrderPreviewResponseDto } from '../../voucher-orders/dto/club-voucher-order.dto';
import type { ClubProductBootstrapResponseDto } from './dto/club-product-bootstrap.dto';

/** 进入页面时的默认购买数量 */
const INITIAL_QUANTITY = 1;

@Injectable()
export class ClubProductBootstrapService {
  private readonly logger = new Logger(ClubProductBootstrapService.name);

  constructor(
    private readonly clubProductsService: ClubProductsService,
    private readonly clubMemberService: ClubMemberService,
    private readonly clubOrderPreviewService: ClubOrderPreviewService,
    private readonly clubVoucherOrdersService: ClubVoucherOrdersService,
  ) {}

  async getBootstrap(
    currentContext: ClubCurrentContext,
    productId: number,
  ): Promise<ClubProductBootstrapResponseDto> {
    // 防御性校验：确保上下文已被拦截器正确解析
    if (!currentContext?.user || !currentContext?.store) {
      throw new BadRequestException(
        '当前请求缺少 purely-club 上下文，请重新进入',
      );
    }

    const product = await this.clubProductsService.getDetail(
      currentContext,
      productId,
    );

    const [account, pointsRatio] = await Promise.all([
      this.fetchAccount(currentContext),
      this.fetchPointsRatio(currentContext),
    ]);

    const storeId = currentContext.store.id;
    const [servicePreview, voucherPreview] = await Promise.all([
      this.fetchServicePreview(currentContext, storeId, product),
      this.fetchVoucherPreview(currentContext, storeId, product),
    ]);

    return {
      product,
      account,
      storeId,
      pointsRatio,
      servicePreview,
      voucherPreview,
    };
  }

  /** 按商品类型取价：两种商品各自只有一条链路会真正发请求，另一路返回 null */
  private async fetchServicePreview(
    currentContext: ClubCurrentContext,
    storeId: number,
    product: ClubProductDto,
  ): Promise<ClubServiceOrderPreviewResponseDto | null> {
    if (product.type === 'voucher') {
      return null;
    }

    try {
      return await this.clubOrderPreviewService.previewServiceOrder(
        currentContext,
        {
          storeId,
          productId: Number(product.id),
          quantity: INITIAL_QUANTITY,
          usePoints: true,
        },
      );
    } catch (error) {
      this.logger.warn('服务详情页价格预计算失败，降级为无 preview', error);
      return null;
    }
  }

  private async fetchVoucherPreview(
    currentContext: ClubCurrentContext,
    storeId: number,
    product: ClubProductDto,
  ): Promise<ClubVoucherOrderPreviewResponseDto | null> {
    if (product.type !== 'voucher') {
      return null;
    }

    try {
      return await this.clubVoucherOrdersService.previewVoucherOrder(
        currentContext,
        {
          storeId,
          productId: Number(product.id),
          quantity: INITIAL_QUANTITY,
          // 团购券默认人数取商品配置，与前端 INITIAL 规格一致
          personCount: product.personCount ?? INITIAL_QUANTITY,
          usePoints: true,
        },
      );
    } catch (error) {
      this.logger.warn(
        '服务详情页团购券价格预计算失败，降级为无 preview',
        error,
      );
      return null;
    }
  }

  private async fetchAccount(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberAccountDto | null> {
    try {
      return await this.clubMemberService.getAccount(currentContext);
    } catch (error) {
      this.logger.warn('服务详情页会员账户获取失败，降级返回', error);
      return null;
    }
  }

  private async fetchPointsRatio(
    currentContext: ClubCurrentContext,
  ): Promise<ClubPointsRatioDto | null> {
    try {
      return await this.clubMemberService.getPointsRatio(currentContext);
    } catch (error) {
      this.logger.warn('服务详情页积分规则获取失败，降级返回', error);
      return null;
    }
  }
}
