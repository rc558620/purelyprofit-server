import {
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
@UseGuards(JwtAuthGuard, PermissionsGuard)
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
    @Body('enabled') enabled: boolean,
  ): Promise<MarketingPromotionDto> {
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
