import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext } from '../pr-feedback/pr-feedback.types';

// Scans normally finish in seconds to a couple of minutes given the
// cost-governed pipeline (Stage 1 first, AI only on flagged files) — 20
// minutes with zero progress means the process that owned this job is gone.
const STALE_AFTER_MS = 20 * 60 * 1000;

/**
 * processScan() runs fire-and-forget, in-process (see RepositoryService) —
 * if the server crashes or redeploys mid-scan, the ScanJob row is left in
 * 'queued'/'processing' forever with nothing to ever move it. This sweep is
 * the reconciliation half: anything stale gets marked 'failed' with a clear
 * reason instead of hanging indefinitely. A PR review's "Reviewing…" check
 * on GitHub/GitLab/Bitbucket is closed too, or it would spin forever.
 */
@Injectable()
export class ScanJobSweepService {
  private readonly logger = new Logger(ScanJobSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prFeedback: PrFeedbackService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepStuckJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const stale = await this.prisma.scanJob.findMany({
      where: { status: { in: ['queued', 'processing'] }, updatedAt: { lt: cutoff } },
      select: { id: true, userId: true, prContext: true },
      take: 200,
    });
    let swept = 0;
    for (const job of stale) {
      // Claimed one at a time, so two instances sweeping at once never both close the same check.
      const { count } = await this.prisma.scanJob.updateMany({
        where: { id: job.id, status: { in: ['queued', 'processing'] } },
        data: {
          status: 'failed',
          error:
            'This scan stalled with no progress (the server likely restarted mid-scan) and was automatically marked failed. Please try again.',
          completedAt: new Date(),
        },
      });
      if (!count) continue;
      swept++;
      if (job.prContext) {
        await this.prFeedback.fail(
          job.userId,
          job.prContext as unknown as PrContext,
          'Audit Bench Ai couldn’t finish reviewing this commit in time. Click Re-run, or push another commit, to try again.',
        );
      }
    }
    if (swept > 0) {
      this.logger.warn(
        `Swept ${swept} stuck scan job(s) to 'failed' after ${STALE_AFTER_MS / 60_000} minutes of no progress`,
      );
    }
    return swept;
  }
}
