import { Injectable, Logger } from '@nestjs/common';
import { PrContext, PrFeedback, PrPublisher } from './pr-feedback.types';

/**
 * Registry so RepositoryService can publish PR/MR feedback without knowing
 * about GitHub/GitLab, and GithubModule/GitlabModule can register their
 * publisher without RepositoryModule importing them back — avoids a
 * circular module dependency (both already depend on RepositoryModule).
 */
@Injectable()
export class PrFeedbackService {
  private readonly logger = new Logger(PrFeedbackService.name);
  private readonly publishers = new Map<PrContext['kind'], PrPublisher>();

  register(kind: PrContext['kind'], publisher: PrPublisher) {
    this.publishers.set(kind, publisher);
  }

  /** Never throws: a failure comes back as the reason, for the scan to record. */
  async publish(
    userId: string,
    context: PrContext,
    feedback: PrFeedback,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const publisher = this.publishers.get(context.kind);
    if (!publisher) {
      this.logger.warn(`No PR feedback publisher registered for "${context.kind}"`);
      return { ok: false, error: `Posting to ${context.kind} isn't available.` };
    }
    try {
      await publisher.publish(userId, context as any, feedback);
      return { ok: true };
    } catch (err) {
      this.logger.error(`Failed to publish PR/MR feedback for ${context.kind}`, err as Error);
      const error = (err as Error).message || 'Posting the review failed.';
      // The review is done but couldn't be posted: close its "Reviewing…"
      // check anyway, or it spins on the pull request forever.
      await this.fail(
        userId,
        context,
        `Audit Bench Ai finished the review but couldn’t post it: ${error}`.slice(0, 1000),
      );
      return { ok: false, error };
    }
  }

  /** A review couldn't finish: clear its "reviewing…" status on the PR. Never throws. */
  async fail(userId: string, context: PrContext, reason: string): Promise<void> {
    const publisher = this.publishers.get(context.kind);
    if (!publisher?.fail) return;
    try {
      await publisher.fail(userId, context as any, reason);
    } catch (err) {
      this.logger.warn(`Couldn't clear the review status for ${context.kind}: ${(err as Error).message}`);
    }
  }
}
