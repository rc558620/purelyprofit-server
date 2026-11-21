import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { ScanOrderingPrintSettings } from './scan-ordering-print-settings.service';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { UpdateScanOrderingPrintSettingsDto } from './dto/scan-ordering-print-settings.dto';
import {
  ScanOrderingPrintDispatchService,
  type ScanOrderingPrintDispatchResult,
  type ScanOrderingPrintTaskStatusResult,
} from './scan-ordering-print-dispatch.service';
import { ScanOrderingUsbPrintService } from './scan-ordering-usb-print.service';
import { PrintAgentService } from './print-agent.service';
import type { PrintAgentPrinter } from './print-agent.service';
import {
  ScanOrderingPrintOrderDto,
  ScanOrderingPrintTaskStatusQueryDto,
  ScanOrderingPrintTestDto,
} from './dto/scan-ordering-print-action.dto';

/** 扫码点餐打印域：打印配置、云/USB 打印任务与打印代理绑定。 */
@ApiTags('PurelyProfit Scan Ordering - Print')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('catering')
@Controller('profit/scan-ordering')
export class ScanOrderingPrintController {
  constructor(
    private readonly printSettingsService: ScanOrderingPrintSettingsService,
    private readonly printDispatchService: ScanOrderingPrintDispatchService,
    private readonly usbPrintService: ScanOrderingUsbPrintService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly printAgentService: PrintAgentService,
    private readonly configService: ConfigService,
  ) {}

  @Get('print-settings')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({
    summary: '获取门店扫码点餐打印配置（收银台/后厨通道与云打印机 SN）',
  })
  getPrintSettings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScanOrderingPrintSettings> {
    return this.printSettingsService.getForMerchant(user);
  }

  @Patch('print-settings')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({ summary: '更新门店扫码点餐打印配置（支持部分更新）' })
  updatePrintSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateScanOrderingPrintSettingsDto,
  ): Promise<ScanOrderingPrintSettings> {
    return this.printSettingsService.updateForMerchant(user, dto);
  }

  @Post('print')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({
    summary:
      '下发打印任务（云/USB）：按门店打印通道分派收银台顾客票 / 后厨制作单',
  })
  async printOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ScanOrderingPrintOrderDto,
  ): Promise<ScanOrderingPrintDispatchResult> {
    // source=auto 由事件触发，多终端会同时下发：去重与任务状态在服务端按
    // 门店/订单/目标收口；返回值明确区分「已下发 / 已打过 / 失败/结果未知」
    return this.printDispatchService.printOrder(user, {
      target: dto.target,
      orderId: dto.orderId,
      source: dto.source ?? 'manual',
    });
  }

  @Get('print/task-status')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({
    summary: '查询订单打印状态（已下发 / 失败 / 结果未知），用于补打前确认',
  })
  getPrintTaskStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ScanOrderingPrintTaskStatusQueryDto,
  ): Promise<ScanOrderingPrintTaskStatusResult> {
    return this.printDispatchService.getTaskStatus(user, {
      orderId: query.orderId,
      target: query.target,
      taskId: query.taskId,
    });
  }

  @Post('print/test')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({
    summary: '打印测试（云/USB）：按门店打印通道向目标打印机下发测试小票',
  })
  testPrint(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ScanOrderingPrintTestDto,
  ): Promise<{ taskId: string }> {
    return this.printDispatchService.testPrint(user, dto.target);
  }

  @Get('print/usb-devices')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({
    summary:
      '探测可用 USB / 系统小票打印机列表（代理模式返回门店代理上报列表）',
  })
  listUsbPrinters(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Array<{ id: string; name: string; type: string }>> {
    return this.usbPrintService.listUsbDevices(user);
  }

  @Post('print-agent/bind-code')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({
    summary:
      '生成/重置门店打印代理绑定码（客户在门店电脑代理中输入以完成绑定）',
  })
  async generatePrintAgentBindCode(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ bindCode: string }> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权操作打印代理配置',
    );
    const bindCode = await this.printAgentService.generateBindCode(storeId);
    return { bindCode };
  }

  @Get('print-agent/download/:platform')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '下载打印代理安装包（macos / windows）' })
  downloadPrintAgent(@Param('platform') platform: string): StreamableFile {
    const fileName =
      platform === 'windows'
        ? 'print-agent-win64.exe'
        : platform === 'macos'
          ? // macOS 分发 zip 包：保留可执行权限，客户双击解压即可运行（浏览器下载裸二进制无执行位）
            'print-agent-macos-app.zip'
          : null;
    if (!fileName) {
      throw new BadRequestException('不支持的平台，仅支持 macos / windows');
    }
    // 安装包由部署流程放置在后端 public/print-agent/ 目录
    const filePath = join(process.cwd(), 'public', 'print-agent', fileName);
    if (!existsSync(filePath)) {
      throw new NotFoundException('打印代理安装包不存在，请联系管理员');
    }
    return new StreamableFile(createReadStream(filePath), {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Get('print-agent/bind-code')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({
    summary: '读取打印代理绑定码（独立授权：只读状态不返回绑定凭据）',
  })
  async getPrintAgentBindCode(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ bindCode: string | null }> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权读取打印代理绑定码',
    );
    const bindCode = await this.printAgentService.getBindCode(storeId);
    return { bindCode };
  }

  @Get('print-agent/status')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '查询门店打印代理绑定与在线状态' })
  async getPrintAgentStatus(@CurrentUser() user: AuthenticatedUser): Promise<{
    online: boolean;
    lastSeenAt: number | null;
    printers: PrintAgentPrinter[];
    /** 门店最近注册代理的版本号（旧版代理无上报时为 null）。 */
    agentVersion: string | null;
    /** 最新可下载版本（发版时与代理 Version 常量同步）。 */
    latestVersion: string;
  }> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看打印代理配置',
    );
    // 在线状态在 cluster 下需读 Redis 在线标记（getPrinters 为内存读取）
    const [agentVersion, status] = await Promise.all([
      this.printAgentService.getLatestRegisteredVersion(storeId),
      this.printAgentService.getAgentStatus(storeId),
    ]);
    // 打印机列表仅在代理在线时返回：离线期间继续展示会让商家误以为可下发
    const printers = status.online
      ? await this.printAgentService.getPrinters(storeId)
      : [];
    return {
      online: status.online,
      lastSeenAt: status.lastSeenAt,
      printers,
      agentVersion,
      latestVersion:
        this.configService.get<string>('printAgent.latestVersion') ?? '0.1.5',
    };
  }
}
