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
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  EmployeeResponseDto,
  EmployeesOverviewQueryDto,
  EmployeesOverviewResponseDto,
  ListEmployeesQueryDto,
  PaginatedEmployeesResponseDto,
} from './dto/employee-response.dto';
import { ResignEmployeeDto } from './dto/resign-employee.dto';
import { UpdateEmployeeSubAccountDto } from './dto/employee-sub-account.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesProfileController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '新增员工档案' })
  @ApiCreatedResponse({ type: EmployeeResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.create(user, dto);
  }

  @Get()
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取员工列表' })
  @ApiOkResponse({ type: PaginatedEmployeesResponseDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEmployeesQueryDto,
  ): Promise<PaginatedEmployeesResponseDto> {
    return this.employeesService.list(user, query);
  }

  @Get('overview')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取员工概览统计' })
  @ApiOkResponse({ type: EmployeesOverviewResponseDto })
  getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmployeesOverviewQueryDto,
  ): Promise<EmployeesOverviewResponseDto> {
    return this.employeesService.getOverview(user, query);
  }

  @Get(':id')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取员工详情' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  getDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) employeeId: number,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.getDetail(user, employeeId);
  }

  @Patch(':id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新员工档案' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) employeeId: number,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.update(user, employeeId, dto);
  }

  @Patch(':id/sub-account')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '配置员工子账号角色、账号与密码' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  updateSubAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) employeeId: number,
    @Body() dto: UpdateEmployeeSubAccountDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.updateSubAccount(user, employeeId, dto);
  }

  @Post(':id/resign')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '办理员工离职' })
  @ApiCreatedResponse({ type: EmployeeResponseDto })
  resign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) employeeId: number,
    @Body() dto: ResignEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.resign(user, employeeId, dto);
  }

  @Delete(':id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除员工档案' })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) employeeId: number,
  ): Promise<void> {
    await this.employeesService.remove(user, employeeId);
  }
}
