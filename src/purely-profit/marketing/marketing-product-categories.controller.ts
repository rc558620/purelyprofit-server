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
import { BusinessModeGuard } from '../stores/business-mode.guard';
import { RequireBusinessMode } from '../stores/business-mode.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  MarketingProductCategoriesResponseDto,
  MarketingProductCategoryDto,
} from './dto/marketing-product.response.dto';
import type {
  CreateMarketingProductCategoryDto,
  UpdateMarketingProductCategoryDto,
} from './dto/marketing-product-category.dto';
import { MarketingProductsFacadeService } from './marketing.service';

@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('marketing/product-categories')
export class MarketingProductCategoriesController {
  constructor(
    private readonly marketingProductsFacadeService: MarketingProductsFacadeService,
  ) {}

  @Get()
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '产品分类列表' })
  @ApiOkResponse({ type: MarketingProductCategoriesResponseDto })
  listProductCategories(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<MarketingProductCategoriesResponseDto> {
    return this.marketingProductsFacadeService.listProductCategories(
      user,
      storeId,
    );
  }

  @Post()
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '新增产品分类' })
  @ApiCreatedResponse({ type: MarketingProductCategoryDto })
  createProductCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMarketingProductCategoryDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingProductCategoryDto> {
    return this.marketingProductsFacadeService.createProductCategory(
      user,
      storeId,
      dto,
    );
  }

  @Patch(':id')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '编辑产品分类' })
  @ApiOkResponse({ type: MarketingProductCategoryDto })
  updateProductCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMarketingProductCategoryDto,
  ): Promise<MarketingProductCategoryDto> {
    return this.marketingProductsFacadeService.updateProductCategory(
      user,
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermissions('marketing:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除产品分类' })
  @ApiNoContentResponse()
  deleteProductCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.marketingProductsFacadeService.deleteProductCategory(user, id);
  }
}
