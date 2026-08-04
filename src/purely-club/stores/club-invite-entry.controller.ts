import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClubPublicInviteEntryResponseDto } from './dto/club-store.dto';
import { ClubStoreAccessService } from './club-store-access.service';

/**
 * 邀请二维码公开落地入口（无鉴权）。
 *
 * 微信/系统相机/浏览器扫码访问 {publicBaseUrl}/i/v1/{inviteCode} 时，
 * 由网关/H5 落地页转发到该接口完成解析与确认；
 * H5 或小程序也可直接调用，拿到目标门店与状态后自行引导。
 *
 * 注意：
 * - 本接口不执行任何状态变更（不建会员、不绑定），仅返回必要落地信息；
 * - 不返回手机号、结算、商家敏感配置；
 * - 路径参数只接受邀请码，解析侧有格式白名单校验。
 */
@ApiTags('邀请二维码公开落地')
@Controller('public/invite-entries')
export class ClubInviteEntryController {
  constructor(
    private readonly clubStoreAccessService: ClubStoreAccessService,
  ) {}

  @Get('v1/:inviteCode')
  @ApiOperation({
    summary: '解析并确认邀请二维码（无鉴权公开落地入口）',
    description:
      '根据邀请码返回目标门店摘要与状态（active / inactive / not_found），不做任何状态变更。支持 ?t= 渠道 token 进行扫码归因与单张撤销判定。',
  })
  @ApiQuery({
    name: 't',
    required: false,
    description: '渠道二维码公开 token（?t=xxx），用于归因与已撤销判定',
  })
  @ApiOkResponse({ type: ClubPublicInviteEntryResponseDto })
  resolveInviteEntry(
    @Param('inviteCode') inviteCode: string,
    @Query('t') issueToken?: string,
  ): Promise<ClubPublicInviteEntryResponseDto> {
    return this.clubStoreAccessService.resolvePublicInviteEntry(
      inviteCode,
      issueToken,
    );
  }
}
