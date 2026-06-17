import {
  InternalServerErrorException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { ClubCurrentContext } from './club-stores.types';

export const CurrentClubContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClubCurrentContext => {
    const request = context.switchToHttp().getRequest<{
      clubCurrentContext?: ClubCurrentContext;
    }>();

    if (!request.clubCurrentContext) {
      throw new InternalServerErrorException('当前请求缺少 purely-club 上下文');
    }

    return request.clubCurrentContext;
  },
);
