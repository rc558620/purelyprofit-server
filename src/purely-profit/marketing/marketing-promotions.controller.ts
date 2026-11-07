import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AllowLegacyOwnerAccess,
  RequirePermissions,
} from '../access-control/decorators/require-permissions.decorator';
import { BlockSubAccount } from '../access-control/decorators/block-sub-account.decorator';
import { SubAccountBlockGuard } from '../access-control/guards/sub-account-block.guard';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreatePromotionDto,
  ListPromotionsQueryDto,
  UpdatePromotionDto,
} from './dto/marketing-query.dto';
import {
  MarketingPromotionDto,
  MarketingPromotionsResponseDto,
} from './dto/marketing-response.dto';
import { MarketingService } from './marketing.service';

@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard, SubAccountBlockGuard)
// 优惠活动对全部子账号（含店长）关闭：marketing:view 放行后读接口会一并开放，
// 因此这里用与权限码解耦的账号级 Guard 兜底，覆盖本类全部 6 个读写接口。
@BlockSubAccount('子账号无权访问优惠活动')
@Controller('marketing/promotions')
export class MarketingPromotionsController {
  constructor(private readonly marketingService: MarketingService) {}

  @Get()
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '活动列表' })
  @ApiOkResponse({ type: MarketingPromotionsResponseDto })
  listPromotions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPromotionsQueryDto,
  ): Promise<MarketingPromotionsResponseDto> {
    return this.marketingService.listPromotions(user, query);
  }

  @Post()
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '创建活动' })
  @ApiCreatedResponse({ type: MarketingPromotionDto })
  createPromotion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePromotionDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingPromotionDto> {
    return this.marketingService.createPromotion(user, storeId, dto);
  }

  @Get(':id')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '活动详情' })
  @ApiOkResponse({ type: MarketingPromotionDto })
  getPromotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MarketingPromotionDto> {
    return this.marketingService.getPromotion(user, id);
  }

  @Patch(':id')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '编辑活动' })
  @ApiOkResponse({ type: MarketingPromotionDto })
  updatePromotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    return this.marketingService.updatePromotion(user, id, dto);
  }

  @Patch(':id/toggle')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '上架/下架活动' })
  @ApiOkResponse({ type: MarketingPromotionDto })
  togglePromotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('enabled') enabledRaw: unknown,
  ): Promise<MarketingPromotionDto> {
    // B8：宽松化解析 enabled，支持 true/false/1/0/"1"/"0"/"true"/"false"
    const TRUTHY = new Set<unknown>([true, 'true', 1, '1']);
    const FALSY = new Set<unknown>([false, 'false', 0, '0']);
    if (!TRUTHY.has(enabledRaw) && !FALSY.has(enabledRaw)) {
      throw new BadRequestException(
        'enabled 为必填布尔值，支持 true/false/1/0/"1"/"0"/"true"/"false"',
      );
    }
    const enabled = TRUTHY.has(enabledRaw);
    return this.marketingService.togglePromotion(user, id, enabled);
  }

  @Delete(':id')
  @RequirePermissions('marketing:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除活动' })
  @ApiNoContentResponse()
  deletePromotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.marketingService.deletePromotion(user, id);
  }
}
