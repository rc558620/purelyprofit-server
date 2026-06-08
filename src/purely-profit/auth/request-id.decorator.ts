import {
  InternalServerErrorException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';

export const RequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context
      .switchToHttp()
      .getRequest<{ id?: string | number }>();

    if (request.id === undefined || request.id === null) {
      throw new InternalServerErrorException('当前请求缺少 request id');
    }

    return String(request.id);
  },
);
