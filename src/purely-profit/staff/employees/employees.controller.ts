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
import {
  CreateEmployeeDictionaryDto,
  EmployeeDepartmentResponseDto,
  EmployeePositionResponseDto,
  EmployeeStoreQueryDto,
  UpdateEmployeeDictionaryDto,
} from './dto/employee-dictionary.dto';
import {
  CreateEmployeeLeaveDto,
  EmployeeLeaveResponseDto,
  UpdateEmployeeLeaveDto,
} from './dto/employee-leave.dto';
import {
  EmployeePayrollReportResponseDto,
  EmployeePayrollResponseDto,
  ListEmployeePayrollsQueryDto,
  SaveEmployeePayrollDto,
  UpdateEmployeePayrollDto,
} from './dto/employee-payroll.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  EmployeeResponseDto,
  EmployeesOverviewQueryDto,
  EmployeesOverviewResponseDto,
  ListEmployeesQueryDto,
  PaginatedEmployeesResponseDto,
} from './dto/employee-response.dto';
import {
  CreateEmployeeShiftDto,
  EmployeeShiftReportResponseDto,
  EmployeeShiftResponseDto,
  ListEmployeeShiftsQueryDto,
  UpdateEmployeeShiftDto,
} from './dto/employee-shift.dto';
import {
  CreateEmployeeShiftDefinitionDto,
  EmployeeShiftDefinitionResponseDto,
  UpdateEmployeeShiftDefinitionDto,
} from './dto/employee-shift-definition.dto';
import { ResignEmployeeDto } from './dto/resign-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmployeeSubAccountDto } from './dto/employee-sub-account.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '新增员工档案' })
  @ApiCreatedResponse({ type: EmployeeResponseDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.create(request.user, dto);
  }

  @Get()
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取员工列表' })
  @ApiOkResponse({ type: PaginatedEmployeesResponseDto })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListEmployeesQueryDto,
  ): Promise<PaginatedEmployeesResponseDto> {
    return this.employeesService.list(request.user, query);
  }

  @Get('overview')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取员工概览统计' })
  @ApiOkResponse({ type: EmployeesOverviewResponseDto })
  getOverview(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: EmployeesOverviewQueryDto,
  ): Promise<EmployeesOverviewResponseDto> {
    return this.employeesService.getOverview(request.user, query);
  }

  @Get('departments')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取部门列表' })
  @ApiOkResponse({ type: [EmployeeDepartmentResponseDto] })
  listDepartments(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: EmployeeStoreQueryDto,
  ): Promise<EmployeeDepartmentResponseDto[]> {
    return this.employeesService.listDepartments(request.user, query);
  }

  @Post('departments')
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '新增部门' })
  @ApiCreatedResponse({ type: EmployeeDepartmentResponseDto })
  createDepartment(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    return this.employeesService.createDepartment(request.user, dto);
  }

  @Patch('departments/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新部门' })
  @ApiOkResponse({ type: EmployeeDepartmentResponseDto })
  updateDepartment(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) departmentId: number,
    @Body() dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    return this.employeesService.updateDepartment(
      request.user,
      departmentId,
      dto,
    );
  }

  @Delete('departments/:id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除部门' })
  @ApiNoContentResponse()
  async removeDepartment(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) departmentId: number,
  ): Promise<void> {
    await this.employeesService.removeDepartment(request.user, departmentId);
  }

  @Get('positions')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取职位列表' })
  @ApiOkResponse({ type: [EmployeePositionResponseDto] })
  listPositions(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: EmployeeStoreQueryDto,
  ): Promise<EmployeePositionResponseDto[]> {
    return this.employeesService.listPositions(request.user, query);
  }

  @Post('positions')
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '新增职位' })
  @ApiCreatedResponse({ type: EmployeePositionResponseDto })
  createPosition(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    return this.employeesService.createPosition(request.user, dto);
  }

  @Patch('positions/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新职位' })
  @ApiOkResponse({ type: EmployeePositionResponseDto })
  updatePosition(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) positionId: number,
    @Body() dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    return this.employeesService.updatePosition(request.user, positionId, dto);
  }

  @Delete('positions/:id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除职位' })
  @ApiNoContentResponse()
  async removePosition(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) positionId: number,
  ): Promise<void> {
    await this.employeesService.removePosition(request.user, positionId);
  }

  @Get('shift-definitions')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取班次定义列表' })
  @ApiOkResponse({ type: [EmployeeShiftDefinitionResponseDto] })
  listShiftDefinitions(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: EmployeeStoreQueryDto,
  ): Promise<EmployeeShiftDefinitionResponseDto[]> {
    return this.employeesService.listShiftDefinitions(request.user, query);
  }

  @Post('shift-definitions')
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '新增班次定义' })
  @ApiCreatedResponse({ type: EmployeeShiftDefinitionResponseDto })
  createShiftDefinition(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateEmployeeShiftDefinitionDto,
  ): Promise<EmployeeShiftDefinitionResponseDto> {
    return this.employeesService.createShiftDefinition(request.user, dto);
  }

  @Patch('shift-definitions/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新班次定义' })
  @ApiOkResponse({ type: EmployeeShiftDefinitionResponseDto })
  updateShiftDefinition(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) shiftDefinitionId: number,
    @Body() dto: UpdateEmployeeShiftDefinitionDto,
  ): Promise<EmployeeShiftDefinitionResponseDto> {
    return this.employeesService.updateShiftDefinition(
      request.user,
      shiftDefinitionId,
      dto,
    );
  }

  @Delete('shift-definitions/:id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除班次定义' })
  @ApiNoContentResponse()
  async removeShiftDefinition(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) shiftDefinitionId: number,
  ): Promise<void> {
    await this.employeesService.removeShiftDefinition(
      request.user,
      shiftDefinitionId,
    );
  }

  @Get('shifts/report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取排班报表数据' })
  @ApiOkResponse({ type: EmployeeShiftReportResponseDto })
  getShiftReport(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListEmployeeShiftsQueryDto,
  ): Promise<EmployeeShiftReportResponseDto> {
    return this.employeesService.getShiftReport(request.user, query);
  }

  @Get('shifts')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取排班列表' })
  @ApiOkResponse({ type: [EmployeeShiftResponseDto] })
  listShifts(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListEmployeeShiftsQueryDto,
  ): Promise<EmployeeShiftResponseDto[]> {
    return this.employeesService.listShifts(request.user, query);
  }

  @Post('shifts')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '新增排班' })
  @ApiCreatedResponse({ type: EmployeeShiftResponseDto })
  createShift(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateEmployeeShiftDto,
  ): Promise<EmployeeShiftResponseDto> {
    return this.employeesService.createShift(request.user, dto);
  }

  @Patch('shifts/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新排班' })
  @ApiOkResponse({ type: EmployeeShiftResponseDto })
  updateShift(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) shiftId: number,
    @Body() dto: UpdateEmployeeShiftDto,
  ): Promise<EmployeeShiftResponseDto> {
    return this.employeesService.updateShift(request.user, shiftId, dto);
  }

  @Delete('shifts/:id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除排班' })
  @ApiNoContentResponse()
  async removeShift(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) shiftId: number,
  ): Promise<void> {
    await this.employeesService.removeShift(request.user, shiftId);
  }

  @Get('payrolls/report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取工资报表数据' })
  @ApiOkResponse({ type: EmployeePayrollReportResponseDto })
  getPayrollReport(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListEmployeePayrollsQueryDto,
  ): Promise<EmployeePayrollReportResponseDto> {
    return this.employeesService.getPayrollReport(request.user, query);
  }

  @Get('payrolls')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取工资列表' })
  @ApiOkResponse({ type: [EmployeePayrollResponseDto] })
  listPayrolls(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListEmployeePayrollsQueryDto,
  ): Promise<EmployeePayrollResponseDto[]> {
    return this.employeesService.listPayrolls(request.user, query);
  }

  @Post('payrolls')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '保存工资草稿' })
  @ApiCreatedResponse({ type: EmployeePayrollResponseDto })
  savePayroll(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: SaveEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesService.savePayroll(request.user, dto);
  }

  @Patch('payrolls/:id')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '编辑工资草稿' })
  @ApiOkResponse({ type: EmployeePayrollResponseDto })
  updatePayroll(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) payrollId: number,
    @Body() dto: UpdateEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesService.updatePayroll(request.user, payrollId, dto);
  }

  @Post('payrolls/:id/confirm')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '确认工资结算' })
  @ApiCreatedResponse({ type: EmployeePayrollResponseDto })
  confirmPayroll(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) payrollId: number,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesService.confirmPayroll(request.user, payrollId);
  }

  @Delete('payrolls/:id')
  @RequirePermissions('finance:view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除工资记录' })
  @ApiNoContentResponse()
  async removePayroll(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) payrollId: number,
  ): Promise<void> {
    await this.employeesService.removePayroll(request.user, payrollId);
  }

  @Get(':id/leaves')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取员工请假记录' })
  @ApiOkResponse({ type: [EmployeeLeaveResponseDto] })
  listLeaves(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) employeeId: number,
  ): Promise<EmployeeLeaveResponseDto[]> {
    return this.employeesService.listLeaves(request.user, employeeId);
  }

  @Post(':id/leaves')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '新增员工请假记录' })
  @ApiCreatedResponse({ type: EmployeeLeaveResponseDto })
  createLeave(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) employeeId: number,
    @Body() dto: CreateEmployeeLeaveDto,
  ): Promise<EmployeeLeaveResponseDto> {
    return this.employeesService.createLeave(request.user, employeeId, dto);
  }

  @Patch('leaves/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新请假记录' })
  @ApiOkResponse({ type: EmployeeLeaveResponseDto })
  updateLeave(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) leaveId: number,
    @Body() dto: UpdateEmployeeLeaveDto,
  ): Promise<EmployeeLeaveResponseDto> {
    return this.employeesService.updateLeave(request.user, leaveId, dto);
  }

  @Delete('leaves/:id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除请假记录' })
  @ApiNoContentResponse()
  async removeLeave(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) leaveId: number,
  ): Promise<void> {
    await this.employeesService.removeLeave(request.user, leaveId);
  }

  @Get(':id')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取员工详情' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  getDetail(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) employeeId: number,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.getDetail(request.user, employeeId);
  }

  @Patch(':id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新员工档案' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  update(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) employeeId: number,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.update(request.user, employeeId, dto);
  }

  @Patch(':id/sub-account')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '配置员工子账号角色、账号与密码' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  updateSubAccount(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) employeeId: number,
    @Body() dto: UpdateEmployeeSubAccountDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.updateSubAccount(
      request.user,
      employeeId,
      dto,
    );
  }

  @Post(':id/resign')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '办理员工离职' })
  @ApiCreatedResponse({ type: EmployeeResponseDto })
  resign(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) employeeId: number,
    @Body() dto: ResignEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.resign(request.user, employeeId, dto);
  }

  @Delete(':id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除员工档案' })
  @ApiNoContentResponse()
  async remove(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) employeeId: number,
  ): Promise<void> {
    await this.employeesService.remove(request.user, employeeId);
  }
}
