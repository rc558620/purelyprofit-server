import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ScanOrderingSessionArchiveService } from '../purely-profit/operations/scan-ordering/scan-ordering-session-archive.service';

@Processor('scan-ordering-session-archive', { concurrency: 1 })
export class ScanOrderingSessionArchiveProcessor extends WorkerHost {
  constructor(
    private readonly archiveService: ScanOrderingSessionArchiveService,
  ) {
    super();
  }

  async process(_job: Job<void, number, string>): Promise<number> {
    return this.archiveService.archiveEligibleSessions();
  }
}
