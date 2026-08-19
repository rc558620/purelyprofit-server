import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
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
import type {
  PrintChannel,
  ScanOrderingPrintSettings,
} from './scan-ordering-print-settings.service';
import { ScanOrderingPrintSettingsService } from './scan-ordering-print-settings.service';
import { UpdateScanOrderingPrintSettingsDto } from './dto/scan-ordering-print-settings.dto';
import { ScanOrderingCloudPrintService } from './scan-ordering-cloud-print.service';
import type { CloudPrintTarget } from './scan-ordering-cloud-print.service';
import { ScanOrderingUsbPrintService } from './scan-ordering-usb-print.service';
import { PrintAgentService } from './print-agent.service';
import type { PrintAgentPrinter } from './print-agent.service';
import { ScanOrderingPrintOrderDto } from './dto/scan-ordering-print-action.dto';
import { ScanOrderingPrintTestDto } from './dto/scan-ordering-print-action.dto';

/** 扫码点餐打印域：打印配置、云/USB 打印任务与打印代理绑定。 */
@ApiTags('PurelyProfit Scan Ordering - Print')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('catering')
@Controller('profit/scan-ordering')
export class ScanOrderingPrintController {
  constructor(
    private readonly printSettingsService: ScanOrderingPrintSettingsService,
    private readonly cloudPrintService: ScanOrderingCloudPrintService,
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
  ): Promise<{ orderId: string }> {
    const channel = await this.resolveChannel(user, dto.target);
    if (channel === 'usb') {
      const orderId = await this.usbPrintService.printForMerchant(
        user,
        dto.target,
        dto.orderId,
      );
      return { orderId };
    }
    const orderId = await this.cloudPrintService.printForMerchant(
      user,
      dto.target,
      dto.orderId,
    );
    return { orderId };
  }

  @Post('print/test')
  @RequirePermissions('scan-ordering:order-process')
  @ApiOperation({
    summary: '打印测试（云/USB）：按门店打印通道向目标打印机下发测试小票',
  })
  async testPrint(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ScanOrderingPrintTestDto,
  ): Promise<{ orderId: string }> {
    const channel = await this.resolveChannel(user, dto.target);
    if (channel === 'usb') {
      const orderId = await this.usbPrintService.testPrintForMerchant(
        user,
        dto.target,
      );
      return { orderId };
    }
    const orderId = await this.cloudPrintService.testPrintForMerchant(
      user,
      dto.target,
    );
    return { orderId };
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

  @Get('print-agent/status')
  @RequirePermissions('scan-ordering:view')
  @ApiOperation({ summary: '查询门店打印代理绑定与在线状态' })
  async getPrintAgentStatus(@CurrentUser() user: AuthenticatedUser): Promise<{
    bindCode: string | null;
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
    // getAgentStatus / getPrinters 为同步内存读取，仅绑定码与版本需异步查询
    const [bindCode, agentVersion] = await Promise.all([
      this.printAgentService.getBindCode(storeId),
      this.printAgentService.getLatestRegisteredVersion(storeId),
    ]);
    const status = this.printAgentService.getAgentStatus(storeId);
    const printers = this.printAgentService.getPrinters(storeId);
    return {
      bindCode,
      online: status.online,
      lastSeenAt: status.lastSeenAt,
      printers,
      agentVersion,
      latestVersion:
        this.configService.get<string>('printAgent.latestVersion') ?? '0.1.0',
    };
  }

  /** 按打印目标读取门店配置的打印通道。 */
  private async resolveChannel(
    user: AuthenticatedUser,
    target: CloudPrintTarget,
  ): Promise<PrintChannel> {
    const settings = await this.printSettingsService.getForMerchant(user);
    return target === 'kitchen'
      ? settings.kitchenPrintChannel
      : settings.cashierPrintChannel;
  }
}
