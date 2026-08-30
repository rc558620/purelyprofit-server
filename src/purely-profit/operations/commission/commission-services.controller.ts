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
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommissionServicesService } from './commission-services.service';
import {
  CommissionServiceResponseDto,
  UpsertCommissionServiceDto,
} from './dto/commission-service.dto';

@ApiTags('CommissionServices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('commission-services')
export class CommissionServicesController {
  constructor(
    private readonly commissionServicesService: CommissionServicesService,
  ) {}

  @Get()
  @RequirePermissions('commission:view')
  @ApiOperation({ summary: '获取当前门店提成服务配置列表' })
  @ApiOkResponse({ type: [CommissionServiceResponseDto] })
  list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommissionServiceResponseDto[]> {
    return this.commissionServicesService.list(user);
  }

  @Post()
  @RequirePermissions('commission:manage')
  @ApiOperation({ summary: '新增提成服务配置' })
  @ApiCreatedResponse({ type: CommissionServiceResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertCommissionServiceDto,
  ): Promise<CommissionServiceResponseDto> {
    return this.commissionServicesService.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('commission:manage')
  @ApiOperation({ summary: '更新提成服务配置（overrides 全量替换）' })
  @ApiOkResponse({ type: CommissionServiceResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) serviceId: number,
    @Body() dto: UpsertCommissionServiceDto,
  ): Promise<CommissionServiceResponseDto> {
    return this.commissionServicesService.update(user, serviceId, dto);
  }

  @Delete(':id')
  @RequirePermissions('commission:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除提成服务配置（软删除）' })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) serviceId: number,
  ): Promise<void> {
    await this.commissionServicesService.remove(user, serviceId);
  }
}
