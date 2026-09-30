// 客存 C 端控制器：我的客存列表/详情、输码预览、确认/拒绝、取件码生命周期
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { CurrentClubContext } from '../stores/current-club-context.decorator';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubCustodyService } from './club-custody.service';
import {
  ClubCustodyAckResponseDto,
  ClubCustodyOrderDetailResponseDto,
  ClubCustodyOrderListResponseDto,
  ClubCustodyOrderResponseDto,
  ClubCustodyPickupCodeDto,
  ClubCustodyPreviewResponseDto,
  ListClubCustodyOrdersQueryDto,
  PreviewClubCustodyByCodeDto,
} from './dto/club-custody.dto';

@ApiTags('Club / Custody')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/custody-orders')
export class ClubCustodyController {
  constructor(private readonly clubCustodyService: ClubCustodyService) {}

  @Get()
  @ApiOperation({
    summary: '查询我的客存列表',
    description:
      '游标分页返回当前会员在当前门店的客存存单（草稿与作废不透出），并附会员维度汇总。',
  })
  @ApiOkResponse({ type: ClubCustodyOrderListResponseDto })
  listOrders(
    @CurrentClubContext() context: ClubCurrentContext,
    @Query() query: ListClubCustodyOrdersQueryDto,
  ): Promise<ClubCustodyOrderListResponseDto> {
    return this.clubCustodyService.listOrders(context, query);
  }

  @Post('preview-by-code')
  @ApiOperation({
    summary: '按确认码预览待确认客存',
    description:
      '校验店员出示的 6 位确认码并返回草稿存单预览；此步骤不消费确认码。',
  })
  @ApiOkResponse({ type: ClubCustodyPreviewResponseDto })
  previewByCode(
    @CurrentClubContext() context: ClubCurrentContext,
    @Body() dto: PreviewClubCustodyByCodeDto,
  ): Promise<ClubCustodyPreviewResponseDto> {
    return this.clubCustodyService.previewByCode(context, dto.code);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询我的客存详情与取出流水' })
  @ApiOkResponse({ type: ClubCustodyOrderDetailResponseDto })
  getOrderDetail(
    @CurrentClubContext() context: ClubCurrentContext,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<ClubCustodyOrderDetailResponseDto> {
    return this.clubCustodyService.getOrderDetail(context, orderId);
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary: '确认客存存入',
    description:
      '会员确认后草稿存单流转到在存，确认码同时失效；并发确认只有第一次生效。',
  })
  @ApiOkResponse({ type: ClubCustodyOrderResponseDto })
  confirmStore(
    @CurrentClubContext() context: ClubCurrentContext,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<ClubCustodyOrderResponseDto> {
    return this.clubCustodyService.confirmStore(context, orderId);
  }

  @Post(':id/reject')
  @ApiOperation({
    summary: '拒绝客存存入',
    description: '会员拒绝后草稿存单被撤销，商家端列表不再展示该存单。',
  })
  @ApiCreatedResponse({ type: ClubCustodyAckResponseDto })
  rejectStore(
    @CurrentClubContext() context: ClubCurrentContext,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<ClubCustodyAckResponseDto> {
    return this.clubCustodyService.rejectStore(context, orderId);
  }

  @Post(':id/pickup-code')
  @ApiOperation({
    summary: '生成取件码',
    description:
      '为在存存单签发 6 位取件码，60 秒有效；重复生成会覆盖上一枚未核销的码。',
  })
  @ApiCreatedResponse({ type: ClubCustodyPickupCodeDto })
  createPickupCode(
    @CurrentClubContext() context: ClubCurrentContext,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<ClubCustodyPickupCodeDto> {
    return this.clubCustodyService.createPickupCode(context, orderId);
  }

  @Post(':id/cancel-pickup')
  @ApiOperation({
    summary: '取消取件码',
    description: '客户主动作废尚未核销的取件码，重复调用幂等成功。',
  })
  @ApiCreatedResponse({ type: ClubCustodyAckResponseDto })
  cancelPickupCode(
    @CurrentClubContext() context: ClubCurrentContext,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<ClubCustodyAckResponseDto> {
    return this.clubCustodyService.cancelPickupCode(context, orderId);
  }
}
