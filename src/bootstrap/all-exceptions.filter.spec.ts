import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: { status: jest.Mock; send: jest.Mock };
  let mockRequest: { method: string; url: string; id: string };

  const createMockHost = () =>
    ({
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    }) as unknown as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    mockRequest = {
      method: 'GET',
      url: '/api/test',
      id: 'req-123',
    };
  });

  describe('生产环境', () => {
    beforeEach(() => {
      filter = new AllExceptionsFilter(true);
    });

    it('HttpException 保留原始 statusCode 和 message', () => {
      const exception = new BadRequestException('参数错误');

      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: '参数错误',
          requestId: 'req-123',
          path: '/api/test',
        }),
      );
    });

    it('非 HttpException 隐藏内部错误细节', () => {
      const exception = new Error('数据库连接失败: ECONNREFUSED');

      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: '服务器内部错误，请稍后重试',
        }),
      );
    });

    it('401 Unauthorized 正确传递消息', () => {
      const exception = new UnauthorizedException('登录态已失效');

      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: '登录态已失效',
        }),
      );
    });

    it('包含 timestamp 和 path', () => {
      filter.catch(new BadRequestException('test'), createMockHost());

      const sentBody = mockResponse.send.mock.calls[0][0];
      expect(sentBody.timestamp).toBeDefined();
      expect(sentBody.path).toBe('/api/test');
    });
  });

  describe('开发环境', () => {
    beforeEach(() => {
      filter = new AllExceptionsFilter(false);
    });

    it('非 HttpException 暴露原始错误消息', () => {
      const exception = new Error('数据库连接失败');

      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: '数据库连接失败',
        }),
      );
    });
  });

  describe('ValidationPipe 数组错误', () => {
    beforeEach(() => {
      filter = new AllExceptionsFilter(true);
    });

    it('将数组 message 拼接为分号分隔字符串', () => {
      const exception = new HttpException(
        { statusCode: 400, message: ['字段A不能为空', '字段B格式错误'] },
        400,
      );

      filter.catch(exception, createMockHost());

      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '字段A不能为空; 字段B格式错误',
        }),
      );
    });
  });
});
