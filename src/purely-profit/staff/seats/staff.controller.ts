import { CurrentUser } from '../../auth/current-user.decorator';
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { ActivateStaffDto } from './dto/activate-staff.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { StaffActivationResponseDto } from './dto/staff-activation-response.dto';
import {
  ListStaffQueryDto,
  PaginatedStaffResponseDto,
  StaffResponseDto,
} from './dto/staff-response.dto';
import { StaffInviteResponseDto } from './dto/staff-invite-response.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

@ApiTags('Staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '新增员工' })
  @ApiCreatedResponse({
    description: '新增成功并返回员工信息',
    type: StaffResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStaffDto,
  ): Promise<StaffResponseDto> {
    return this.staffService.create(user, dto);
  }

  @Post('invite')
  @RequirePermissions('staff:create')
  @ApiOperation({ summary: '邀请员工' })
  @ApiCreatedResponse({
    description: '员工邀请成功并返回席位占用概览',
    type: StaffInviteResponseDto,
  })
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteStaffDto,
  ): Promise<StaffInviteResponseDto> {
    return this.staffService.invite(user, dto);
  }

  @Post('activate')
  @ApiOperation({ summary: '员工激活账号席位' })
  @ApiCreatedResponse({
    description: '员工账号激活成功并返回席位占用概览',
    type: StaffActivationResponseDto,
  })
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ActivateStaffDto,
  ): Promise<StaffActivationResponseDto> {
    return this.staffService.activate(user, dto);
  }

  @Get()
  @RequirePermissions('staff:view')
  @ApiOperation({ summary: '获取当前用户门店下的员工列表' })
  @ApiOkResponse({
    description: '返回当前用户可管理的员工列表与分页信息',
    type: PaginatedStaffResponseDto,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListStaffQueryDto,
  ): Promise<PaginatedStaffResponseDto> {
    return this.staffService.list(user, query);
  }

  @Patch(':id')
  @RequirePermissions('staff:update')
  @ApiOperation({ summary: '更新员工信息' })
  @ApiOkResponse({
    description: '更新成功并返回员工信息',
    type: StaffResponseDto,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) staffId: number,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffResponseDto> {
    return this.staffService.update(user, staffId, dto);
  }

  @Delete(':id')
  @RequirePermissions('staff:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除员工' })
  @ApiNoContentResponse({ description: '删除成功' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) staffId: number,
  ): Promise<void> {
    await this.staffService.remove(user, staffId);
  }
}
