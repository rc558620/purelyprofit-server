import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * purely-club dev-only 登录接口的可用性守卫。
 *
 * `POST /club/auth/login/send-code` 与 `POST /club/auth/login/code`
 * 仅供本地 / 测试环境调试使用：C 端生产身份完全由微信静默登录
 * （`POST /club/auth/login/wechat`）决定，登录页在前端生产构建下已被门禁
 * 拦截（前端 routeGuard 按 NODE_ENV 判断，生产直接 reLaunch 首页）。
 *
 * 但前端门禁拦不住绕过前端、直接调用接口的请求，缺少服务端守卫会留下一条
 * 「手机号验证码登录」的后门通道。
 *
 * 用 Guard 而不是在 controller 方法体内判断，是为了让拦截发生在
 * ValidationPipe 之前：管道先于方法体执行，若等到方法体内才抛 404，
 * 生产环境携带非法 body 的探测请求会先被全局校验管道拦成 400，
 * 反而坐实「该路由存在」，破坏 404 伪装。
 *
 * 生产环境统一抛 NotFoundException（而非 403），避免向外部暴露接口存在。
 */
@Injectable()
export class ClubDevLoginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const nodeEnv = this.configService.get<string>('nodeEnv') ?? 'development';
    if (nodeEnv === 'production') {
      throw new NotFoundException();
    }
    return true;
  }
}
