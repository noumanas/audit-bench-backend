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

  async publish(userId: string, context: PrContext, feedback: PrFeedback): Promise<void> {
    const publisher = this.publishers.get(context.kind);
    if (!publisher) {
      this.logger.warn(`No PR feedback publisher registered for "${context.kind}"`);
      return;
    }
    try {
      await publisher.publish(userId, context as any, feedback);
    } catch (err) {
      this.logger.error(`Failed to publish PR/MR feedback for ${context.kind}`, err as Error);
    }
  }
}
