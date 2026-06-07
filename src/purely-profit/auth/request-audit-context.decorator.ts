import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface RequestAuditContextValue {
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

function readHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  headerName: string,
): string | undefined {
  const rawValue = headers?.[headerName.toLowerCase()];

  if (typeof rawValue === 'string') {
    return rawValue;
  }

  if (Array.isArray(rawValue) && rawValue.length > 0) {
    return rawValue[0];
  }

  return undefined;
}

export const RequestAuditContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestAuditContextValue => {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
    }>();

    return {
      requestId: readHeader(request.headers, 'x-request-id'),
      userAgent: readHeader(request.headers, 'user-agent'),
      ip: request.ip,
    };
  },
);
