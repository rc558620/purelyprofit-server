import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import {
  CreatePurchaseDto,
  ListPurchasesQueryDto,
  PaginatedPurchasesResponseDto,
  PurchaseResponseDto,
  PurchaseStatsQueryDto,
  PurchaseStatsResponseDto,
} from './dto/purchase.dto';
import { PurchasesService } from './purchases.service';

@ApiTags('Purchases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(['purchases', 'purchase-orders'])
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get()
  @RequirePermissions('purchase:view')
  @ApiOperation({ summary: '获取进货单列表' })
  @ApiOkResponse({ type: PaginatedPurchasesResponseDto })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListPurchasesQueryDto,
  ): Promise<PaginatedPurchasesResponseDto> {
    return this.purchasesService.list(request.user, query);
  }

  @Get('stats')
  @RequirePermissions('purchase:view')
  @ApiOperation({ summary: '获取进货统计' })
  @ApiOkResponse({ type: PurchaseStatsResponseDto })
  getStats(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: PurchaseStatsQueryDto,
  ): Promise<PurchaseStatsResponseDto> {
    return this.purchasesService.getStats(request.user, query);
  }

  @Post()
  @RequirePermissions('purchase:create')
  @ApiOperation({ summary: '创建进货单' })
  @ApiCreatedResponse({ type: PurchaseResponseDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreatePurchaseDto,
  ): Promise<PurchaseResponseDto> {
    return this.purchasesService.create(request.user, dto);
  }

  @Delete(':id')
  @RequirePermissions('purchase:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除进货单' })
  @ApiNoContentResponse()
  async remove(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) purchaseId: number,
  ): Promise<void> {
    await this.purchasesService.remove(request.user, purchaseId);
  }
}
