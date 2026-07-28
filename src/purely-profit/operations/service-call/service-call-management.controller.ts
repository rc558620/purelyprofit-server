import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProcessServiceCallDto } from './dto/process-service-call.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { ServiceCallManagementService } from './service-call-management.service';

@ApiTags('PurelyProfit Service Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('profit/service-calls')
export class ServiceCallManagementController {
  constructor(private readonly service: ServiceCallManagementService) {}

  @Get()
  @RequirePermissions('service-call:view')
  @ApiOperation({ summary: '获取门店服务呼叫工作台队列' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Patch(':serviceCallId')
  @RequirePermissions('service-call:process')
  @ApiOperation({ summary: '处理门店服务呼叫' })
  process(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceCallId', ParseIntPipe) serviceCallId: number,
    @Body() dto: ProcessServiceCallDto,
  ): Promise<void> {
    return this.service.process(user, serviceCallId, dto.status, dto.remark);
  }
}
