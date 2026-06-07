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
import {
  CreateEmployeeLeaveDto,
  EmployeeLeaveResponseDto,
  UpdateEmployeeLeaveDto,
} from './dto/employee-leave.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesLeavesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get(':id/leaves')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取员工请假记录' })
  @ApiOkResponse({ type: [EmployeeLeaveResponseDto] })
  listLeaves(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) employeeId: number,
  ): Promise<EmployeeLeaveResponseDto[]> {
    return this.employeesService.listLeaves(user, employeeId);
  }

  @Post(':id/leaves')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '新增员工请假记录' })
  @ApiCreatedResponse({ type: EmployeeLeaveResponseDto })
  createLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) employeeId: number,
    @Body() dto: CreateEmployeeLeaveDto,
  ): Promise<EmployeeLeaveResponseDto> {
    return this.employeesService.createLeave(user, employeeId, dto);
  }

  @Patch('leaves/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新请假记录' })
  @ApiOkResponse({ type: EmployeeLeaveResponseDto })
  updateLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) leaveId: number,
    @Body() dto: UpdateEmployeeLeaveDto,
  ): Promise<EmployeeLeaveResponseDto> {
    return this.employeesService.updateLeave(user, leaveId, dto);
  }

  @Delete('leaves/:id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除请假记录' })
  @ApiNoContentResponse()
  async removeLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) leaveId: number,
  ): Promise<void> {
    await this.employeesService.removeLeave(user, leaveId);
  }
}
