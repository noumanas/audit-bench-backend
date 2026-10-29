import { ScanJobSweepService } from './scan-job-sweep.service';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';

describe('ScanJobSweepService', () => {
  const setup = (stale: Array<{ id: string; userId: string; prContext: unknown }>, claimed = 1) => {
    const prisma = {
      scanJob: {
        findMany: jest.fn().mockResolvedValue(stale),
        updateMany: jest.fn().mockResolvedValue({ count: claimed }),
      },
    };
    const prFeedback = { fail: jest.fn().mockResolvedValue(undefined) };
    return { prisma, prFeedback, sweep: new ScanJobSweepService(prisma as never, prFeedback as never) };
  };
  const pr = { kind: 'github', owner: 'acme', repo: 'api', pullNumber: 7, headSha: 'sha', checkRunId: 99 };

  it('marks a stalled PR review failed and closes its "Reviewing…" check', async () => {
    const { sweep, prFeedback, prisma } = setup([{ id: 'j1', userId: 'u1', prContext: pr }]);
    expect(await sweep.sweepStuckJobs()).toBe(1);
    expect(prisma.scanJob.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'j1' });
    expect(prFeedback.fail).toHaveBeenCalledWith('u1', pr, expect.stringContaining('Re-run'));
  });

  it("doesn't touch a check another instance already closed", async () => {
    const { sweep, prFeedback } = setup([{ id: 'j1', userId: 'u1', prContext: pr }], 0);
    expect(await sweep.sweepStuckJobs()).toBe(0);
    expect(prFeedback.fail).not.toHaveBeenCalled();
  });

  it('fails a stalled repository scan without any check to close', async () => {
    const { sweep, prFeedback } = setup([{ id: 'j2', userId: 'u1', prContext: null }]);
    expect(await sweep.sweepStuckJobs()).toBe(1);
    expect(prFeedback.fail).not.toHaveBeenCalled();
  });
});

describe('PrFeedbackService.publish when posting fails', () => {
  it('still closes the "Reviewing…" check', async () => {
    const service = new PrFeedbackService();
    const publisher = {
      publish: jest.fn().mockRejectedValue(new Error('GitHub refused the comment (403)')),
      fail: jest.fn(),
    };
    service.register('github', publisher as never);
    const ctx = { kind: 'github', owner: 'acme', repo: 'api', pullNumber: 7, headSha: 'sha' };
    const outcome = await service.publish('u1', ctx as never, { verdict: 'pass', summary: '', findings: [] } as never);
    expect(outcome).toEqual({ ok: false, error: 'GitHub refused the comment (403)' });
    expect(publisher.fail).toHaveBeenCalledWith('u1', ctx, expect.stringContaining('couldn’t post it: GitHub refused'));
  });
});
