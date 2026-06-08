import { CurrentUser } from '../auth/current-user.decorator';
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
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreateFinanceAccountDto,
  ListFinanceAccountsQueryDto,
  SettleFinanceAccountDto,
} from './dto/finance-account.query.dto';
import {
  CreateFinanceCashFlowRecordDto,
  ListFinanceCashFlowRecordsQueryDto,
} from './dto/finance-cash-flow.query.dto';
import { FinanceOverviewQueryDto } from './dto/finance-overview.query.dto';
import {
  ConfirmFinanceReconciliationDto,
  CreateFinanceReconciliationDto,
  ListFinanceReconciliationsQueryDto,
} from './dto/finance-reconciliation.query.dto';
import { FinanceReportQueryDto } from './dto/finance-report.query.dto';
import {
  FinanceAccountRecordResponseDto,
  FinanceAccountsStatsDto,
  PaginatedFinanceAccountsResponseDto,
} from './dto/finance-account.response.dto';
import {
  FinanceCashFlowRecordResponseDto,
  FinanceCashFlowStatsDto,
  PaginatedFinanceCashFlowRecordsResponseDto,
} from './dto/finance-cash-flow.response.dto';
import { FinanceOverviewResponseDto } from './dto/finance-overview.response.dto';
import { FinanceReportResponseDto } from './dto/finance-report.response.dto';
import {
  FinanceReconciliationRecordResponseDto,
  FinanceReconciliationStatsDto,
  PaginatedFinanceReconciliationsResponseDto,
} from './dto/finance-reconciliation.response.dto';
import { FinanceService } from './finance.service';

@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('overview')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '获取财务总览数据' })
  @ApiOkResponse({
    description: '返回财务管理总览页所需的汇总卡、趋势和收支构成',
    type: FinanceOverviewResponseDto,
  })
  getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceOverviewQueryDto,
  ): Promise<FinanceOverviewResponseDto> {
    return this.financeService.getOverview(user, query);
  }

  @Get('report')
  @RequirePermissions('report:view')
  @ApiOperation({ summary: '获取报表中心财务报表数据' })
  @ApiOkResponse({
    description: '返回报表中心财务 Tab 所需的概况、流水行和账款行',
    type: FinanceReportResponseDto,
  })
  getReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceReportQueryDto,
  ): Promise<FinanceReportResponseDto> {
    return this.financeService.getReport(user, query);
  }

  @Get('cash-flow/records')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '获取现金流水列表' })
  @ApiOkResponse({
    description: '返回现金流水页所需的记录列表与分页信息',
    type: PaginatedFinanceCashFlowRecordsResponseDto,
  })
  listCashFlowRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceCashFlowRecordsQueryDto,
  ): Promise<PaginatedFinanceCashFlowRecordsResponseDto> {
    return this.financeService.listCashFlowRecords(user, query);
  }

  @Get('cash-flow/stats')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '获取现金流水统计' })
  @ApiOkResponse({
    description: '返回现金流水页顶部统计卡所需数据',
    type: FinanceCashFlowStatsDto,
  })
  getCashFlowStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceCashFlowRecordsQueryDto,
  ): Promise<FinanceCashFlowStatsDto> {
    return this.financeService.getCashFlowStats(user, query);
  }

  @Post('cash-flow/records')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '新增现金流水' })
  @ApiCreatedResponse({
    description: '创建成功并返回最新现金流水记录',
    type: FinanceCashFlowRecordResponseDto,
  })
  createCashFlowRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFinanceCashFlowRecordDto,
  ): Promise<FinanceCashFlowRecordResponseDto> {
    return this.financeService.createCashFlowRecord(user, dto);
  }

  @Delete('cash-flow/records/:id')
  @RequirePermissions('finance:view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除现金流水' })
  @ApiNoContentResponse({ description: '删除成功' })
  deleteCashFlowRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) recordId: number,
  ): Promise<void> {
    return this.financeService.deleteCashFlowRecord(user, recordId);
  }

  @Get('accounts')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '获取账款列表' })
  @ApiOkResponse({
    description: '返回账款管理页所需的记录列表与分页信息',
    type: PaginatedFinanceAccountsResponseDto,
  })
  listAccounts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceAccountsQueryDto,
  ): Promise<PaginatedFinanceAccountsResponseDto> {
    return this.financeService.listAccounts(user, query);
  }

  @Get('accounts/stats')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '获取账款统计' })
  @ApiOkResponse({
    description: '返回账款管理页顶部统计卡所需数据',
    type: FinanceAccountsStatsDto,
  })
  getAccountsStats(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinanceAccountsStatsDto> {
    return this.financeService.getAccountsStats(user);
  }

  @Post('accounts')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '新增账款' })
  @ApiCreatedResponse({
    description: '创建成功并返回最新账款记录',
    type: FinanceAccountRecordResponseDto,
  })
  createAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    return this.financeService.createAccount(user, dto);
  }

  @Patch('accounts/:id/settle')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '登记账款收付' })
  @ApiOkResponse({
    description: '登记本次收付后返回最新账款记录',
    type: FinanceAccountRecordResponseDto,
  })
  settleAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) recordId: number,
    @Body() dto: SettleFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    return this.financeService.settleAccount(user, recordId, dto);
  }

  @Delete('accounts/:id')
  @RequirePermissions('finance:view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除账款' })
  @ApiNoContentResponse({ description: '删除成功' })
  deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) recordId: number,
  ): Promise<void> {
    return this.financeService.deleteAccount(user, recordId);
  }

  @Get('reconciliation')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '获取对账单列表' })
  @ApiOkResponse({
    description: '返回资金对账页所需的列表与分页信息',
    type: PaginatedFinanceReconciliationsResponseDto,
  })
  listReconciliations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceReconciliationsQueryDto,
  ): Promise<PaginatedFinanceReconciliationsResponseDto> {
    return this.financeService.listReconciliations(user, query);
  }

  @Get('reconciliation/stats')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '获取对账统计' })
  @ApiOkResponse({
    description: '返回资金对账页顶部统计卡所需数据',
    type: FinanceReconciliationStatsDto,
  })
  getReconciliationStats(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinanceReconciliationStatsDto> {
    return this.financeService.getReconciliationStats(user);
  }

  @Post('reconciliation')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '新建对账单' })
  @ApiCreatedResponse({
    description: '创建成功并返回完整对账单记录',
    type: FinanceReconciliationRecordResponseDto,
  })
  createReconciliation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    return this.financeService.createReconciliation(user, dto);
  }

  @Patch('reconciliation/:id/confirm')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '确认或调整对账单' })
  @ApiOkResponse({
    description: '确认/调整成功并返回最新对账单记录',
    type: FinanceReconciliationRecordResponseDto,
  })
  confirmReconciliation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) recordId: number,
    @Body() dto: ConfirmFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    return this.financeService.confirmReconciliation(user, recordId, dto);
  }

  @Delete('reconciliation/:id')
  @RequirePermissions('finance:view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除对账单' })
  @ApiNoContentResponse({ description: '删除成功' })
  deleteReconciliation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) recordId: number,
  ): Promise<void> {
    return this.financeService.deleteReconciliation(user, recordId);
  }
}
