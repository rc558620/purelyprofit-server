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
  CreateEmployeeDictionaryDto,
  EmployeeDepartmentResponseDto,
  EmployeePositionResponseDto,
  EmployeeStoreQueryDto,
  UpdateEmployeeDictionaryDto,
} from './dto/employee-dictionary.dto';
import {
  CreateEmployeeShiftDefinitionDto,
  EmployeeShiftDefinitionResponseDto,
  UpdateEmployeeShiftDefinitionDto,
} from './dto/employee-shift-definition.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees')
export class EmployeesDictionaryController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get('departments')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取部门列表' })
  @ApiOkResponse({ type: [EmployeeDepartmentResponseDto] })
  listDepartments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmployeeStoreQueryDto,
  ): Promise<EmployeeDepartmentResponseDto[]> {
    return this.employeesService.listDepartments(user, query);
  }

  @Post('departments')
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '新增部门' })
  @ApiCreatedResponse({ type: EmployeeDepartmentResponseDto })
  createDepartment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    return this.employeesService.createDepartment(user, dto);
  }

  @Patch('departments/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新部门' })
  @ApiOkResponse({ type: EmployeeDepartmentResponseDto })
  updateDepartment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) departmentId: number,
    @Body() dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    return this.employeesService.updateDepartment(
      user,
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
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) departmentId: number,
  ): Promise<void> {
    await this.employeesService.removeDepartment(user, departmentId);
  }

  @Get('positions')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取职位列表' })
  @ApiOkResponse({ type: [EmployeePositionResponseDto] })
  listPositions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmployeeStoreQueryDto,
  ): Promise<EmployeePositionResponseDto[]> {
    return this.employeesService.listPositions(user, query);
  }

  @Post('positions')
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '新增职位' })
  @ApiCreatedResponse({ type: EmployeePositionResponseDto })
  createPosition(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    return this.employeesService.createPosition(user, dto);
  }

  @Patch('positions/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新职位' })
  @ApiOkResponse({ type: EmployeePositionResponseDto })
  updatePosition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) positionId: number,
    @Body() dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    return this.employeesService.updatePosition(user, positionId, dto);
  }

  @Delete('positions/:id')
  @RequirePermissions('staff:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除职位' })
  @ApiNoContentResponse()
  async removePosition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) positionId: number,
  ): Promise<void> {
    await this.employeesService.removePosition(user, positionId);
  }

  @Get('shift-definitions')
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取班次定义列表' })
  @ApiOkResponse({ type: [EmployeeShiftDefinitionResponseDto] })
  listShiftDefinitions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmployeeStoreQueryDto,
  ): Promise<EmployeeShiftDefinitionResponseDto[]> {
    return this.employeesService.listShiftDefinitions(user, query);
  }

  @Post('shift-definitions')
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '新增班次定义' })
  @ApiCreatedResponse({ type: EmployeeShiftDefinitionResponseDto })
  createShiftDefinition(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeShiftDefinitionDto,
  ): Promise<EmployeeShiftDefinitionResponseDto> {
    return this.employeesService.createShiftDefinition(user, dto);
  }

  @Patch('shift-definitions/:id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新班次定义' })
  @ApiOkResponse({ type: EmployeeShiftDefinitionResponseDto })
  updateShiftDefinition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) shiftDefinitionId: number,
    @Body() dto: UpdateEmployeeShiftDefinitionDto,
  ): Promise<EmployeeShiftDefinitionResponseDto> {
    return this.employeesService.updateShiftDefinition(
      user,
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
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) shiftDefinitionId: number,
  ): Promise<void> {
    await this.employeesService.removeShiftDefinition(
      user,
      shiftDefinitionId,
    );
  }
}
