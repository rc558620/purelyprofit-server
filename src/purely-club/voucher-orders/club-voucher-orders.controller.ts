// 纯利宝团购券订单控制器：创建/列表/详情/核销/退款/支付确认（Club 端）
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import { ClubCurrentContextInterceptor } from '../stores/club-current-context.interceptor';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CurrentClubContext } from '../stores/current-club-context.decorator';
import { ClubVoucherOrdersService } from './club-voucher-orders.service';
import {
  ClubVoucherOrderDetailDto,
  ClubVoucherOrderListResponseDto,
  ClubVoucherOrderPreviewResponseDto,
  ClubVoucherOrderResponseDto,
  ClubVoucherOrderStatusQueryDto,
  CreateClubVoucherOrderDto,
  ListClubVoucherOrdersQueryDto,
  PreviewClubVoucherOrderDto,
} from './dto/club-voucher-order.dto';

@ApiTags('Club / Voucher Orders')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/voucher-orders')
export class ClubVoucherOrdersController {
  constructor(
    private readonly clubVoucherOrdersService: ClubVoucherOrdersService,
  ) {}

  @Post('preview')
  // 算价含活动/会员/积分多路查询，无限制时会被反复调用放大 DB 压力
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary: '预计算 purely-club 团购券订单价格',
    description:
      '基于当前用户的会员等级、活动优惠和积分，预计算指定团购券商品的完整价格拆解，不创建订单。',
  })
  @ApiOkResponse({ type: ClubVoucherOrderPreviewResponseDto })
  previewVoucherOrder(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Body() dto: PreviewClubVoucherOrderDto,
  ): Promise<ClubVoucherOrderPreviewResponseDto> {
    return this.clubVoucherOrdersService.previewVoucherOrder(
      currentContext,
      dto,
    );
  }

  @Post()
  // 下单会调用微信 JSAPI 预支付，与充值下单同一口径（60s/20 次）
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({
    summary: '创建 purely-club 团购券订单草稿',
    description:
      '基于当前 purely-club 用户的当前门店和团购券商品，创建一笔待支付订单草稿并返回微信支付参数；支付成功后生成团购券码。',
  })
  @ApiCreatedResponse({ type: ClubVoucherOrderResponseDto })
  createVoucherOrder(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Body() dto: CreateClubVoucherOrderDto,
    // 可选幂等键：带上则重复提交返回同一笔订单，不带则保持旧行为。
    // 服务层与支付层都支持该参数，之前漏传会让前端的幂等键彻底失效。
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ClubVoucherOrderResponseDto> {
    return this.clubVoucherOrdersService.createVoucherOrder(
      currentContext,
      dto,
      idempotencyKey,
    );
  }

  @Get()
  @ApiOperation({
    summary: '查询 purely-club 我的团购券订单列表',
    description:
      '返回当前用户已支付的团购券订单，支持按状态筛选与分页；未支付草稿不返回。',
  })
  @ApiOkResponse({ type: ClubVoucherOrderListResponseDto })
  listVoucherOrders(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Query() query: ListClubVoucherOrdersQueryDto,
  ): Promise<ClubVoucherOrderListResponseDto> {
    return this.clubVoucherOrdersService.listVoucherOrders(
      currentContext,
      query,
    );
  }

  @Get(':orderNo')
  @ApiOperation({
    summary: '查询 purely-club 团购券订单详情',
    description:
      '返回当前用户指定团购券订单的完整信息（券码/金额/核销/退款状态）。',
  })
  @ApiOkResponse({ type: ClubVoucherOrderDetailDto })
  getVoucherOrderDetail(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('orderNo') orderNo: string,
    @Query() query: ClubVoucherOrderStatusQueryDto,
  ): Promise<ClubVoucherOrderDetailDto> {
    return this.clubVoucherOrdersService.getVoucherOrderDetail(
      currentContext,
      orderNo,
      query,
    );
  }

  @Post(':orderNo/verify')
  @ApiOperation({
    summary: '立即核销 purely-club 团购券',
    description:
      '用户到店后主动核销：待使用 → 已核销（已使用）。核销后商家仍可读取券码开台，开台成功后才真正绑定会话。',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        orderNo: { type: 'string' },
        status: { type: 'string', example: 'used' },
        verifyAt: { type: 'string' },
      },
    },
  })
  verifyVoucherOrder(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('orderNo') orderNo: string,
  ): Promise<{ orderNo: string; status: 'used'; verifyAt: string }> {
    return this.clubVoucherOrdersService.verifyVoucherOrder(
      currentContext,
      orderNo,
    );
  }

  @Post(':orderNo/refund')
  @ApiOperation({
    summary: '退款 purely-club 团购券',
    description:
      '核销前（待使用/已核销未开台）可退款：微信原路退回 + 积分退回 + 库存回补；已开台使用的券禁止退款。',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        orderNo: { type: 'string' },
        status: { type: 'string', example: 'refunded' },
        refundAt: { type: 'string' },
        refundAmountFen: { type: 'number' },
      },
    },
  })
  refundVoucherOrder(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('orderNo') orderNo: string,
  ): Promise<{
    orderNo: string;
    status: 'refunded';
    refundAt: string;
    refundAmountFen: number;
  }> {
    return this.clubVoucherOrdersService.refundVoucherOrder(
      currentContext,
      orderNo,
    );
  }

  @Post(':orderNo/confirm-paid')
  @ApiOperation({
    summary: '确认 purely-club 团购券订单支付成功（开发态兜底）',
    description:
      '仅在开发态作为联调兜底保留；生产链路由微信支付回调驱动真实落账（生成券码+扣库存）。',
  })
  @ApiOkResponse({ type: ClubVoucherOrderResponseDto })
  confirmVoucherOrderPaid(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('orderNo') orderNo: string,
  ): Promise<ClubVoucherOrderResponseDto> {
    return this.clubVoucherOrdersService.confirmVoucherOrderPaid(
      currentContext,
      orderNo,
    );
  }
}
