import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { recordSqlQuery } from '../observability';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('database.url');
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    const slowQueryLogEnabled =
      configService.get<boolean>('app.slowQueryLogEnabled') ?? true;
    const slowQueryThresholdMs =
      configService.get<number>('app.slowQueryThresholdMs') ?? 80;

    super({
      adapter,
      log: [{ emit: 'event', level: 'query' }],
    });

    this.$on('query', (event: Prisma.QueryEvent) => {
      recordSqlQuery({
        query: event.query,
        durationMs: event.duration,
        slowThresholdMs: slowQueryThresholdMs,
      });

      if (slowQueryLogEnabled && event.duration >= slowQueryThresholdMs) {
        const compactQuery = event.query.replace(/\s+/g, ' ').trim().slice(0, 240);
        console.warn(
          `[slow-query] ${event.duration}ms target=postgres query="${compactQuery}"`,
        );
      }
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
