import { BadRequestException } from '@nestjs/common';
import { GithubController } from './github.controller';

// Same as pipeline.service.spec: the real Stage 1 module loads prettier's ESM-only build, which Jest can't run.
jest.mock('../audit/stage1/run-stage1', () => ({ runStage1: jest.fn() }));

describe('GithubController.reviewPrByUrl', () => {
  const user = { id: 'u1', organizationId: null, email: 'a@b.c', role: 'user' } as never;
  const snapshot = (over: Record<string, unknown> = {}) => ({
    state: 'open',
    merged: false,
    changedFiles: 1,
    ...over,
  });

  const setup = (snap = snapshot()) => {
    const github = {
      authFor: jest.fn().mockResolvedValue('u1'),
      fetchPrFiles: jest.fn().mockResolvedValue({
        files: [{ path: 'a.ts', content: 'x', changedRanges: [] }],
        url: 'https://github.com/Netflix/metaflow/pull/3414',
        headSha: 'sha',
        headRef: 'feature',
        baseRef: 'master',
        snapshot: snap,
      }),
    };
    const repository = { createDiffReview: jest.fn().mockResolvedValue({ id: 'job1' }) };
    return { github, repository, controller: new GithubController(github as never, repository as never) };
  };

  it('posts back to GitHub only when asked to', async () => {
    const { controller, repository, github } = setup();
    await controller.reviewPrByUrl(user, { prUrl: 'https://github.com/Netflix/metaflow/pull/3414/files', postToGithub: true });
    expect(github.fetchPrFiles).toHaveBeenCalledWith('u1', 'Netflix', 'metaflow', 3414, { withSnapshot: true, withRepoContext: true });
    expect(repository.createDiffReview.mock.calls[0][2]).toMatchObject({
      sourceName: 'Netflix/metaflow#3414',
      sourceType: 'github_pr',
      prContext: { kind: 'github', owner: 'Netflix', repo: 'metaflow', pullNumber: 3414, headSha: 'sha' },
    });
    expect(repository.createDiffReview.mock.calls[0][3]).toEqual({ prSnapshot: snapshot(), repoFiles: undefined });

    await controller.reviewPrByUrl(user, { prUrl: 'Netflix/metaflow#3414', postToGithub: false });
    expect(repository.createDiffReview.mock.calls[1][2].prContext).toBeUndefined();
  });

  it('refuses to comment on a merged pull request, but reviews it in the app', async () => {
    const { controller, repository } = setup(snapshot({ state: 'closed', merged: true }));
    await expect(
      controller.reviewPrByUrl(user, { prUrl: 'github.com/Netflix/metaflow/pull/3332', postToGithub: true }),
    ).rejects.toThrow(/already merged/);
    await controller.reviewPrByUrl(user, { prUrl: 'github.com/Netflix/metaflow/pull/3332', postToGithub: false });
    expect(repository.createDiffReview).toHaveBeenCalledTimes(1);
  });

  it('rejects links that are not pull requests', async () => {
    const { controller } = setup();
    await expect(
      controller.reviewPrByUrl(user, { prUrl: 'https://github.com/Netflix/metaflow', postToGithub: true }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('GithubController with only the GitHub App installed', () => {
  const user = { id: 'u1', organizationId: null, email: 'a@b.c', role: 'user' } as never;

  it('reviews through the installation, and the bot posts the review', async () => {
    const github = {
      authFor: jest.fn().mockResolvedValue({ installationId: 42 }),
      fetchPrFiles: jest.fn().mockResolvedValue({
        files: [],
        url: 'u',
        headSha: 'sha',
        headRef: 'f',
        baseRef: 'main',
        snapshot: undefined,
      }),
    };
    const repository = { createDiffReview: jest.fn().mockResolvedValue({ id: 'job1' }) };
    const controller = new GithubController(github as never, repository as never);
    await controller.reviewPr(user, { owner: 'acme', repo: 'api', pullNumber: 7 } as never);
    expect(github.fetchPrFiles.mock.calls[0][0]).toEqual({ installationId: 42 });
    expect(repository.createDiffReview.mock.calls[0][2].prContext).toMatchObject({ installationId: 42 });
  });
});
