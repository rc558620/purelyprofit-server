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
  Res,
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
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  EmployeePayrollReportResponseDto,
  EmployeePayrollResponseDto,
  ListEmployeePayrollsQueryDto,
  PaginatedEmployeePayrollsResponseDto,
  SaveEmployeePayrollDto,
  UpdateEmployeePayrollDto,
} from './dto/employee-payroll.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesPayrollsController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get('payrolls/report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取工资报表数据' })
  @ApiOkResponse({ type: EmployeePayrollReportResponseDto })
  async getPayrollReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEmployeePayrollsQueryDto,
    @Res({ passthrough: true }) reply: { raw: ServerResponse },
  ): Promise<EmployeePayrollReportResponseDto | typeof reply> {
    if (query.format === 'csv') {
      await this.employeesService.streamPayrollReportCsv(reply.raw, user, query);
      return reply;
    }
    return this.employeesService.getPayrollReport(user, query);
  }

  @Get('payrolls')
  @ApiOperation({ summary: '获取工资列表' })
  @ApiOkResponse({ type: PaginatedEmployeePayrollsResponseDto })
  listPayrolls(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEmployeePayrollsQueryDto,
  ): Promise<PaginatedEmployeePayrollsResponseDto> {
    return this.employeesService.listPayrolls(user, query);
  }

  @Post('payrolls')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '保存工资草稿' })
  @ApiCreatedResponse({ type: EmployeePayrollResponseDto })
  savePayroll(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesService.savePayroll(user, dto);
  }

  @Patch('payrolls/:id')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '编辑工资草稿' })
  @ApiOkResponse({ type: EmployeePayrollResponseDto })
  updatePayroll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) payrollId: number,
    @Body() dto: UpdateEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesService.updatePayroll(user, payrollId, dto);
  }

  @Post('payrolls/:id/confirm')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '确认工资结算' })
  @ApiCreatedResponse({ type: EmployeePayrollResponseDto })
  confirmPayroll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) payrollId: number,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesService.confirmPayroll(user, payrollId);
  }

  @Delete('payrolls/:id')
  @RequirePermissions('finance:view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除工资记录' })
  @ApiNoContentResponse()
  async removePayroll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) payrollId: number,
  ): Promise<void> {
    await this.employeesService.removePayroll(user, payrollId);
  }
}
