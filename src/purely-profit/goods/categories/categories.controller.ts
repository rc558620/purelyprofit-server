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
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CategoriesService } from './categories.service';
import {
  CategoryResponseDto,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

type CategoriesRequest = {
  user: AuthenticatedUser;
};

@ApiTags('Categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermissions('goods:view')
  @ApiOperation({ summary: '获取商品分类列表' })
  @ApiOkResponse({ type: [CategoryResponseDto] })
  list(
    @Req() request: CategoriesRequest,
    @Query() query: ListCategoriesQueryDto,
  ): Promise<CategoryResponseDto[]> {
    return this.categoriesService.list(request.user, query);
  }

  @Post()
  @RequirePermissions('goods:create')
  @ApiOperation({ summary: '新增商品分类' })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  create(
    @Req() request: CategoriesRequest,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.create(request.user, dto);
  }

  @Patch(':id')
  @RequirePermissions('goods:update')
  @ApiOperation({ summary: '更新商品分类' })
  @ApiOkResponse({ type: CategoryResponseDto })
  update(
    @Req() request: CategoriesRequest,
    @Param('id', ParseIntPipe) categoryId: number,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.update(request.user, categoryId, dto);
  }

  @Delete(':id')
  @RequirePermissions('goods:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除商品分类' })
  @ApiNoContentResponse()
  async remove(
    @Req() request: CategoriesRequest,
    @Param('id', ParseIntPipe) categoryId: number,
  ): Promise<void> {
    await this.categoriesService.remove(request.user, categoryId);
  }
}
