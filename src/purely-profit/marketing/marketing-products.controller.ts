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
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreateMarketingProductDto,
  ListMarketingProductsQueryDto,
  MarketingProductDto,
  MarketingProductsResponseDto,
  ToggleMarketingProductDto,
  UpdateMarketingProductDto,
} from './dto/marketing-product.dto';
import { MarketingService } from './marketing.service';

@ApiTags('营销中心')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing/products')
export class MarketingProductsController {
  constructor(private readonly marketingService: MarketingService) {}

  @Get()
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '产品列表' })
  @ApiOkResponse({ type: MarketingProductsResponseDto })
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMarketingProductsQueryDto,
  ): Promise<MarketingProductsResponseDto> {
    return this.marketingService.listProducts(user, query);
  }

  @Post()
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '新增产品' })
  @ApiCreatedResponse({ type: MarketingProductDto })
  createProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMarketingProductDto,
    @Query('storeId', ParseIntPipe) storeId: number,
  ): Promise<MarketingProductDto> {
    return this.marketingService.createProduct(user, storeId, dto);
  }

  @Patch(':id')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '编辑产品' })
  @ApiOkResponse({ type: MarketingProductDto })
  updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMarketingProductDto,
  ): Promise<MarketingProductDto> {
    return this.marketingService.updateProduct(user, id, dto);
  }

  @Patch(':id/toggle')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '上架/下架产品' })
  @ApiOkResponse({ type: MarketingProductDto })
  toggleProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToggleMarketingProductDto,
  ): Promise<MarketingProductDto> {
    return this.marketingService.toggleProduct(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('marketing:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除产品' })
  @ApiNoContentResponse()
  deleteProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.marketingService.deleteProduct(user, id);
  }
}
