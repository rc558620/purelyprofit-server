// 纯利宝团购券订单控制器：创建/列表/详情/核销/退款/支付确认（Club 端）
import {
  Body,
  Controller,
  Get,
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
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
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
  CreateClubVoucherOrderDto,
  PreviewClubVoucherOrderDto,
} from './dto/club-voucher-order.dto';

/** 团购券订单列表筛选入参 */
class ListClubVoucherOrdersQueryDto {
  /** 状态筛选：all/pending/used/refunded/expired */
  @IsOptional()
  @IsIn(['all', 'pending', 'used', 'refunded', 'expired'], {
    message: 'status 不合法',
  })
  status?: string;

  /** 每页数量（默认 20，最大 50） */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最少为 1' })
  @Max(50, { message: 'limit 最大为 50' })
  limit?: number;

  /** 偏移量（默认 0） */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset 必须是整数' })
  @Min(0, { message: 'offset 最少为 0' })
  offset?: number;
}

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
  @ApiOperation({
    summary: '创建 purely-club 团购券订单草稿',
    description:
      '基于当前 purely-club 用户的当前门店和团购券商品，创建一笔待支付订单草稿并返回微信支付参数；支付成功后生成团购券码。',
  })
  @ApiCreatedResponse({ type: ClubVoucherOrderResponseDto })
  createVoucherOrder(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Body() dto: CreateClubVoucherOrderDto,
  ): Promise<ClubVoucherOrderResponseDto> {
    return this.clubVoucherOrdersService.createVoucherOrder(
      currentContext,
      dto,
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
    return this.clubVoucherOrdersService.listVoucherOrders(currentContext, {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
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
  ): Promise<ClubVoucherOrderDetailDto> {
    return this.clubVoucherOrdersService.getVoucherOrderDetail(
      currentContext,
      orderNo,
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
