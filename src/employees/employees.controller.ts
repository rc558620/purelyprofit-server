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
  CreateEmployeeDictionaryDto,
  EmployeeDepartmentResponseDto,
  EmployeePositionResponseDto,
  EmployeeStoreQueryDto,
  UpdateEmployeeDictionaryDto,
} from './dto/employee-dictionary.dto';
import {
  CreateEmployeeLeaveDto,
  EmployeeLeaveResponseDto,
} from './dto/employee-leave.dto';
import {
  EmployeePayrollResponseDto,
  ListEmployeePayrollsQueryDto,
  SaveEmployeePayrollDto,
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
  EmployeeShiftResponseDto,
  ListEmployeeShiftsQueryDto,
} from './dto/employee-shift.dto';
import { ResignEmployeeDto } from './dto/resign-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
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
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '保存工资草稿' })
  @ApiCreatedResponse({ type: EmployeePayrollResponseDto })
  savePayroll(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: SaveEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesService.savePayroll(request.user, dto);
  }

  @Post('payrolls/:id/confirm')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '确认工资结算' })
  @ApiCreatedResponse({ type: EmployeePayrollResponseDto })
  confirmPayroll(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) payrollId: number,
  ): Promise<EmployeePayrollResponseDto> {
    return this.employeesService.confirmPayroll(request.user, payrollId);
  }

  @Delete('payrolls/:id')
  @RequirePermissions('staff:update')
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
