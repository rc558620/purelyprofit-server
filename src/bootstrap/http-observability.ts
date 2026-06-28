import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { recordHttpRequest } from '../observability';

function normalizeObservedRoute(url: string): string {
  const [path = '/'] = url.split('?');
  return path || '/';
}

export function setupHttpObservability(
  app: NestFastifyApplication,
  slowLogEnabled: boolean,
  thresholdMs: number,
): void {
  const httpAdapter = app.getHttpAdapter().getInstance();

  httpAdapter.addHook('onResponse', (request, reply, done) => {
    const durationMs = reply.elapsedTime;
    const route = normalizeObservedRoute(request.url);
    const requestId = String(request.id);

    recordHttpRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs,
      requestId,
      slowThresholdMs: thresholdMs,
    });

    if (slowLogEnabled && durationMs >= thresholdMs) {
      console.warn(
        `[slow-request] ${request.method} ${route} ${reply.statusCode} ${durationMs}ms requestId=${requestId}`,
      );
    }

    done();
  });
}
