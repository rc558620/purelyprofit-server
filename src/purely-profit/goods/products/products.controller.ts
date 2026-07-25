import { CurrentUser } from '../../auth/current-user.decorator';
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
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  CreateProductDto,
  ListProductsQueryDto,
  PaginatedProductsResponseDto,
  ProductResponseDto,
  ScanOrderingStatusResponseDto,
  ToggleScanOrderingStatusDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('goods:view')
  @ApiOperation({ summary: '获取商品列表' })
  @ApiOkResponse({ type: PaginatedProductsResponseDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListProductsQueryDto,
  ): Promise<PaginatedProductsResponseDto> {
    return this.productsService.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('goods:view')
  @ApiOperation({ summary: '获取商品详情' })
  @ApiOkResponse({ type: ProductResponseDto })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<ProductResponseDto> {
    return this.productsService.detail(user, productId);
  }

  @Post()
  @RequirePermissions('goods:create')
  @ApiOperation({ summary: '新增商品' })
  @ApiCreatedResponse({ type: ProductResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('goods:update')
  @ApiOperation({ summary: '更新商品' })
  @ApiOkResponse({ type: ProductResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) productId: number,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(user, productId, dto);
  }

  @Delete(':id')
  @RequirePermissions('goods:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除商品' })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<void> {
    await this.productsService.remove(user, productId);
  }

  @Patch(':id/scan-ordering-status')
  @RequirePermissions('goods:update')
  @RequireBusinessMode('catering')
  @ApiOperation({ summary: '上架/下架到扫码点餐（仅餐饮门店）' })
  @ApiOkResponse({ type: ScanOrderingStatusResponseDto })
  toggleScanOrderingStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) productId: number,
    @Body() dto: ToggleScanOrderingStatusDto,
  ): Promise<ScanOrderingStatusResponseDto> {
    return this.productsService.toggleScanOrderingStatus(user, productId, dto);
  }
}
