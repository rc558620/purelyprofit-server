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
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  CreateEmployeeShiftDto,
  EmployeeShiftReportResponseDto,
  EmployeeShiftResponseDto,
  ListEmployeeShiftsQueryDto,
  PaginatedEmployeeShiftsResponseDto,
  UpdateEmployeeShiftDto,
} from './dto/employee-shift.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesShiftsController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get('shifts/report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取排班报表数据' })
  @ApiOkResponse({ type: EmployeeShiftReportResponseDto })
  getShiftReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEmployeeShiftsQueryDto,
  ): Promise<EmployeeShiftReportResponseDto> {
    return this.employeesService.getShiftReport(user, query);
  }

  @Get('shifts')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取排班列表' })
  @ApiOkResponse({ type: PaginatedEmployeeShiftsResponseDto })
  listShifts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEmployeeShiftsQueryDto,
  ): Promise<PaginatedEmployeeShiftsResponseDto> {
    return this.employeesService.listShifts(user, query);
  }

  @Post('shifts')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '新增排班' })
  @ApiCreatedResponse({ type: EmployeeShiftResponseDto })
  createShift(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeShiftDto,
  ): Promise<EmployeeShiftResponseDto> {
    return this.employeesService.createShift(user, dto);
  }

  @Patch('shifts/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新排班' })
  @ApiOkResponse({ type: EmployeeShiftResponseDto })
  updateShift(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) shiftId: number,
    @Body() dto: UpdateEmployeeShiftDto,
  ): Promise<EmployeeShiftResponseDto> {
    return this.employeesService.updateShift(user, shiftId, dto);
  }

  @Delete('shifts/:id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除排班' })
  @ApiNoContentResponse()
  async removeShift(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) shiftId: number,
  ): Promise<void> {
    await this.employeesService.removeShift(user, shiftId);
  }
}
