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
  CreateSupplierDto,
  ListSuppliersQueryDto,
  SupplierResponseDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('Suppliers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(['suppliers', 'purchase-suppliers'])
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @RequirePermissions('supplier:view')
  @ApiOperation({ summary: '获取供应商列表' })
  @ApiOkResponse({ type: [SupplierResponseDto] })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListSuppliersQueryDto,
  ): Promise<SupplierResponseDto[]> {
    return this.suppliersService.list(request.user, query);
  }

  @Post()
  @RequirePermissions('supplier:create')
  @ApiOperation({ summary: '新增供应商' })
  @ApiCreatedResponse({ type: SupplierResponseDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateSupplierDto,
  ): Promise<SupplierResponseDto> {
    return this.suppliersService.create(request.user, dto);
  }

  @Patch(':id')
  @RequirePermissions('supplier:update')
  @ApiOperation({ summary: '更新供应商' })
  @ApiOkResponse({ type: SupplierResponseDto })
  update(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) supplierId: number,
    @Body() dto: UpdateSupplierDto,
  ): Promise<SupplierResponseDto> {
    return this.suppliersService.update(request.user, supplierId, dto);
  }

  @Delete(':id')
  @RequirePermissions('supplier:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除供应商' })
  @ApiNoContentResponse()
  async remove(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) supplierId: number,
  ): Promise<void> {
    await this.suppliersService.remove(request.user, supplierId);
  }
}
