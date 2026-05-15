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
  Req,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreateProductDto,
  ListProductsQueryDto,
  PaginatedProductsResponseDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('goods:view')
  @ApiOperation({ summary: '获取商品列表' })
  @ApiOkResponse({ type: PaginatedProductsResponseDto })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListProductsQueryDto,
  ): Promise<PaginatedProductsResponseDto> {
    return this.productsService.list(request.user, query);
  }

  @Get(':id')
  @RequirePermissions('goods:view')
  @ApiOperation({ summary: '获取商品详情' })
  @ApiOkResponse({ type: ProductResponseDto })
  detail(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<ProductResponseDto> {
    return this.productsService.detail(request.user, productId);
  }

  @Post()
  @RequirePermissions('goods:create')
  @ApiOperation({ summary: '新增商品' })
  @ApiCreatedResponse({ type: ProductResponseDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.create(request.user, dto);
  }

  @Patch(':id')
  @RequirePermissions('goods:update')
  @ApiOperation({ summary: '更新商品' })
  @ApiOkResponse({ type: ProductResponseDto })
  update(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) productId: number,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(request.user, productId, dto);
  }

  @Delete(':id')
  @RequirePermissions('goods:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除商品' })
  @ApiNoContentResponse()
  async remove(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) productId: number,
  ): Promise<void> {
    await this.productsService.remove(request.user, productId);
  }
}
