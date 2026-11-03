// 纯利宝会员卡（C 端）控制器：可购卡 / 下单 / 查单 / 测试落账 / 我的卡包 / 卡详情
import {
  BadRequestException,
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
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import { ClubCurrentContextInterceptor } from '../stores/club-current-context.interceptor';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CurrentClubContext } from '../stores/current-club-context.decorator';
import { ClubCardOrderService } from './club-card-order.service';
import { ClubCardQueryService } from './club-card-query.service';
import { parseCardId } from './club-card-code.utils';
import {
  ClubMemberCardDto,
  ClubMemberCardOrderDto,
  ClubMemberCardPageDto,
  ClubMemberCardPlanListDto,
  CreateClubCardOrderDto,
  GetClubCardOrderQueryDto,
  ListClubCardPlansQueryDto,
  ListClubCardsQueryDto,
} from './dto/club-cards.dto';

/**
 * C 端会员卡接口。
 *
 * 路由顺序刻意把 `plans` / `orders/:id` 放在 `:id` 之前：
 * 否则 Nest 会把 `/club/cards/plans` 当成卡详情去解析 ID。
 */
@ApiTags('Club / Cards')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/cards')
export class ClubCardsController {
  constructor(
    private readonly clubCardQueryService: ClubCardQueryService,
    private readonly clubCardOrderService: ClubCardOrderService,
  ) {}

  @Get('plans')
  @ApiOperation({
    summary: '查询当前门店可购会员卡',
    description:
      '返回当前门店已上架未删除的卡模板（含售价、有效期文案、适用门店），供 purely-club 购卡页展示档位卡。',
  })
  @ApiOkResponse({ type: ClubMemberCardPlanListDto })
  listPlans(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Query() query: ListClubCardPlansQueryDto,
  ): Promise<ClubMemberCardPlanListDto> {
    return this.clubCardQueryService.listPlans(currentContext, {
      kind: query.kind,
      storeId: query.storeId,
    });
  }

  @Get('orders/:id')
  @ApiOperation({
    summary: '查询购卡订单状态',
    description:
      '返回当前用户本人购卡订单的支付状态；verify=true 时先回微信侧核对并补落账，用于支付结果未知时确认是否已扣款。',
  })
  @ApiOkResponse({ type: ClubMemberCardOrderDto })
  getOrder(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('id') id: string,
    @Query() query: GetClubCardOrderQueryDto,
  ): Promise<ClubMemberCardOrderDto> {
    return this.clubCardOrderService.getOrderStatus(currentContext, id, {
      verify: query.verify,
    });
  }

  @Post('orders')
  @ApiOperation({
    summary: '创建购卡订单并发起微信支付',
    description:
      '校验卡模板归属当前门店与每人限购后创建待支付订单（15 分钟窗口），返回微信 JSAPI 支付参数；支持 Idempotency-Key 幂等。',
  })
  @ApiCreatedResponse({ type: ClubMemberCardOrderDto })
  createOrder(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Body() dto: CreateClubCardOrderDto,
    // 可选幂等键：重复提交复用同一笔订单，避免双击产生两笔待支付单
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ClubMemberCardOrderDto> {
    return this.clubCardOrderService.createOrder(
      currentContext,
      dto,
      idempotencyKey,
    );
  }

  @Post('orders/:id/confirm-paid')
  @ApiOperation({
    summary: '确认购卡订单支付成功（开发态兜底）',
    description:
      '仅供开发/联调环境使用；生产环境直接 403。真实落账由微信支付回调驱动（事务内建卡 + purchase 流水），按 orderNo 幂等。',
  })
  @ApiOkResponse({ type: ClubMemberCardOrderDto })
  confirmOrderPaid(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('id') id: string,
  ): Promise<ClubMemberCardOrderDto> {
    return this.clubCardOrderService.confirmOrderPaid(currentContext, id);
  }

  @Get()
  @ApiOperation({
    summary: '查询我的卡包',
    description:
      '返回当前登录者本人名下（跨门店）的会员卡，支持状态筛选与游标分页；不含他人及未绑定手机号的无主档案。',
  })
  @ApiOkResponse({ type: ClubMemberCardPageDto })
  listMyCards(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Query() query: ListClubCardsQueryDto,
  ): Promise<ClubMemberCardPageDto> {
    return this.clubCardQueryService.listMyCards(currentContext, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: '查询会员卡详情',
    description:
      '返回本人指定会员卡的完整信息与最近使用记录（办卡/核销/释放）。',
  })
  @ApiOkResponse({ type: ClubMemberCardDto })
  getCardDetail(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Param('id') id: string,
  ): Promise<ClubMemberCardDto> {
    const cardId = parseCardId(id);
    if (cardId === null) {
      // 非法 ID 按「不存在」处理：不暴露主键类型细节，也避免 500
      throw new BadRequestException('卡 ID 不合法');
    }
    return this.clubCardQueryService.getCardDetail(currentContext, cardId);
  }
}
