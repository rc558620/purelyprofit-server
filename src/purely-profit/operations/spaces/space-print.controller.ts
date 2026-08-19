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
import { PrintAgentService } from '../scan-ordering/print-agent.service';
import type { PrintAgentPrinter } from '../scan-ordering/print-agent.service';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { SpacePrintSettings } from './space-print-settings.service';
import { SpacePrintSettingsService } from './space-print-settings.service';
import { SpacePrintService } from './space-print.service';
import { UpdateSpacePrintSettingsDto } from './dto/space-print.dto';
import { SpacePrintOrderDto } from './dto/space-print.dto';

/**
 * 空间消费小票打印域：打印配置、云/USB 打印任务与打印代理绑定。
 * 与扫码点餐打印（catering 业态）完全隔离：仅 general 业态门店可访问，
 * 配置独立存储（spacePrint* 字段），共享打印通道基础设施（云/USB/代理）。
 */
@ApiTags('PurelyProfit Spaces - Print')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('profit/spaces')
export class SpacePrintController {
  constructor(
    private readonly printSettingsService: SpacePrintSettingsService,
    private readonly printService: SpacePrintService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly printAgentService: PrintAgentService,
    private readonly configService: ConfigService,
  ) {}

  @Get('print-settings')
  @RequirePermissions('space:view')
  @ApiOperation({
    summary: '获取门店空间消费小票打印配置（通道与云打印机 SN）',
  })
  getPrintSettings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SpacePrintSettings> {
    return this.printSettingsService.getForMerchant(user);
  }

  @Patch('print-settings')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({
    summary: '更新门店空间消费小票打印配置（支持部分更新）',
  })
  updatePrintSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSpacePrintSettingsDto,
  ): Promise<SpacePrintSettings> {
    return this.printSettingsService.updateForMerchant(user, dto);
  }

  @Post('print')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({
    summary: '下发空间消费小票打印任务（云/USB）：按门店打印通道自动分派',
  })
  async printReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SpacePrintOrderDto,
  ): Promise<{ orderId: string }> {
    return this.printService.printForMerchant(user, dto.saleOrderId);
  }

  @Post('print/test')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({
    summary: '空间小票打印测试（云/USB）：按门店打印通道下发测试小票',
  })
  async testPrint(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ orderId: string }> {
    return this.printService.testPrintForMerchant(user);
  }

  @Get('print/usb-devices')
  @RequirePermissions('space:view')
  @ApiOperation({
    summary:
      '探测可用 USB / 系统小票打印机列表（代理模式返回门店代理上报列表）',
  })
  listUsbPrinters(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Array<{ id: string; name: string; type: string }>> {
    return this.printService.listUsbDevices(user);
  }

  @Post('print-agent/bind-code')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({
    summary: '生成/重置门店打印代理绑定码（空间小票 USB 打印通道使用）',
  })
  async generatePrintAgentBindCode(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ bindCode: string }> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'operation-entry:create',
      '无权操作打印代理配置',
    );
    // 复用扫码点餐打印代理体系（门店级绑定，与业态无关）
    const bindCode = await this.printAgentService.generateBindCode(storeId);
    return { bindCode };
  }

  @Get('print-agent/status')
  @RequirePermissions('space:view')
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
      'space:view',
      '无权查看打印代理配置',
    );
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

  @Get('print-agent/download/:platform')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '下载打印代理安装包（macos / windows）' })
  downloadPrintAgent(@Param('platform') platform: string): StreamableFile {
    const fileName =
      platform === 'windows'
        ? 'print-agent-win64.exe'
        : platform === 'macos'
          ? 'print-agent-macos-app.zip'
          : null;
    if (!fileName) {
      throw new BadRequestException('不支持的平台，仅支持 macos / windows');
    }
    // 安装包由部署流程放置在后端 public/print-agent/ 目录（与扫码点餐共用）
    const filePath = join(process.cwd(), 'public', 'print-agent', fileName);
    if (!existsSync(filePath)) {
      throw new NotFoundException('打印代理安装包不存在，请联系管理员');
    }
    return new StreamableFile(createReadStream(filePath), {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
