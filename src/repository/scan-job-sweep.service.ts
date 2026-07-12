import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// Scans normally finish in seconds to a couple of minutes given the
// cost-governed pipeline (Stage 1 first, AI only on flagged files) — 20
// minutes with zero progress means the process that owned this job is gone.
const STALE_AFTER_MS = 20 * 60 * 1000;

/**
 * processScan() runs fire-and-forget, in-process (see RepositoryService) —
 * if the server crashes or redeploys mid-scan, the ScanJob row is left in
 * 'queued'/'processing' forever with nothing to ever move it. This sweep is
 * the reconciliation half: anything stale gets marked 'failed' with a clear
 * reason instead of hanging indefinitely.
 */
@Injectable()
export class ScanJobSweepService {
  private readonly logger = new Logger(ScanJobSweepService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepStuckJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const { count } = await this.prisma.scanJob.updateMany({
      where: { status: { in: ['queued', 'processing'] }, updatedAt: { lt: cutoff } },
      data: {
        status: 'failed',
        error: 'This scan stalled with no progress (the server likely restarted mid-scan) and was automatically marked failed. Please try again.',
        completedAt: new Date(),
      },
    });
    if (count > 0) {
      this.logger.warn(`Swept ${count} stuck scan job(s) to 'failed' after ${STALE_AFTER_MS / 60_000} minutes of no progress`);
    }
  }
}
