import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  UserWithRequestId,
  type UserWithRequestIdValue,
} from '../../auth/user-with-request-id.decorator';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { MemberCareGuard } from '../../stores/member-care.guard';
import { RequireMemberCare } from '../../stores/member-care.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  ListSpaceCareCustomersQueryDto,
  ListSpaceCareRecordsQueryDto,
  SpaceCareCustomerListResponseDto,
  SpaceCareRecordDetailResponseDto,
  SpaceCareRecordDto,
  SpaceCareRecordListResponseDto,
  UpdateSpaceCareRecordDto,
} from './dto/space-care-record.dto';
import { SpaceCareRecordsService } from './space-care-records.service';

/**
 * 会员护理档案（B 端）。
 *
 * 路由固定为 `/space-care-records`，前端 api path 支持环境变量覆盖但默认值硬编码，
 * 改名会直接导致联调失败，禁止调整。
 * 静态路径 `/space-care-records/customers` 必须早于 `SpaceSessionsController`
 * 注册（见 spaces.module.ts 的 controllers 顺序注释）。
 *
 * 功能门槛：仅注册时选择「SPA/养生/美容」模式的门店可用。
 * 非该模式的门店后端整体不运行本功能——入口隐藏、接口 403、结账不建档。
 * 业态门禁（非餐饮）与档位门禁（SPA/养生/美容）是叠加关系，两者都要过。
 */
@ApiTags('SpaceCareRecords')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard, MemberCareGuard)
@RequireBusinessMode('general')
@RequireMemberCare()
@Controller()
export class SpaceCareRecordsController {
  constructor(
    private readonly spaceCareRecordsService: SpaceCareRecordsService,
  ) {}

  @Get('space-care-records/customers')
  @RequirePermissions('space:view')
  @ApiOperation({
    summary: '获取会员护理档案的会员列表',
    description:
      '查询口径与营销中心顾客列表一致（同门店、未软删），支持按活跃状态、昵称、手机号筛选与分页。',
  })
  @ApiOkResponse({ type: SpaceCareCustomerListResponseDto })
  listCustomers(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Query() query: ListSpaceCareCustomersQueryDto,
  ): Promise<SpaceCareCustomerListResponseDto> {
    return this.spaceCareRecordsService.listCustomers(ctx.user, query);
  }

  @Get('space-care-records/customers/:customerId')
  @RequirePermissions('space:view')
  @ApiOperation({
    summary: '获取单个会员的护理档案详情',
    description:
      '一次请求返回护理记录时间线第一页与效果对比首尾；记录按 visitAt 倒序分页，' +
      '第 1 次（基线）落在最后一页。另附顾客摘要（id / 昵称 / 头像）供详情页标题展示；' +
      '完整顾客身份 / 账户概览仍在营销域顾客详情。',
  })
  @ApiOkResponse({ type: SpaceCareRecordDetailResponseDto })
  getCustomerDetail(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: ListSpaceCareRecordsQueryDto,
  ): Promise<SpaceCareRecordDetailResponseDto> {
    return this.spaceCareRecordsService.getCustomerDetail(
      ctx.user,
      customerId,
      query,
    );
  }

  @Get('space-care-records/customers/:customerId/records')
  @RequirePermissions('space:view')
  @ApiOperation({
    summary: '分页获取会员的护理记录时间线',
    description:
      '详情首屏之后的翻页入口：按 visitAt 倒序返回指定页记录，不重复返回顾客档案与累计充值。',
  })
  @ApiOkResponse({ type: SpaceCareRecordListResponseDto })
  listCustomerRecords(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: ListSpaceCareRecordsQueryDto,
  ): Promise<SpaceCareRecordListResponseDto> {
    return this.spaceCareRecordsService.listCustomerRecords(
      ctx.user,
      customerId,
      query,
    );
  }

  @Patch('space-care-records/:recordId')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({
    summary: '补录护理记录的图文',
    description:
      '只允许修改护理说明与现场照片；seq / visitAt / serviceName / amountYuan / technicianName 为结账快照，只读。',
  })
  @ApiOkResponse({ type: SpaceCareRecordDto })
  updateRecord(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('recordId', ParseIntPipe) recordId: number,
    @Body() dto: UpdateSpaceCareRecordDto,
  ): Promise<SpaceCareRecordDto> {
    return this.spaceCareRecordsService.updateRecord(ctx.user, recordId, dto);
  }
}
