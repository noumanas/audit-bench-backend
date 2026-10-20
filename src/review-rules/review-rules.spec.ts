import { ReviewRulesService, repoFromSourceName, rulesPromptText, LEARN_THRESHOLD } from './review-rules.service';

describe('repoFromSourceName', () => {
  it.each([
    ['acme/api#12', 'github_pr', 'acme/api'],
    ['group/project !3', 'gitlab_mr', 'group/project'],
    ['acme/api', 'github_repo', 'acme/api'],
    ['upload.zip', 'zip', null],
  ])('%s (%s) → %s', (name, type, expected) => {
    expect(repoFromSourceName(name, type)).toBe(expected);
  });
});

describe('rulesPromptText', () => {
  it('lists the team rules and what not to raise', () => {
    const text = rulesPromptText({
      instructions: ['We use tabs.'],
      ignorePaths: ['generated/**'],
      suppress: [{ fingerprint: 'f', text: 'Console logging in scripts (Maintainability)' }],
      key: 'k',
    });
    expect(text).toContain('Team rules (follow them; they override the defaults above):\n- We use tabs.');
    expect(text).toContain("Don't raise them:\n- Console logging in scripts (Maintainability)");
    expect(text).not.toContain('generated/**');
    expect(rulesPromptText({ instructions: [], ignorePaths: [], suppress: [], key: '' })).toBe('');
  });
});

describe('ReviewRulesService.learn', () => {
  const owner = { id: 'u1', organizationId: 'org1' };
  const setup = (signals: Record<string, number>, existing: unknown = null) => {
    const prisma = {
      findingFeedback: {
        groupBy: jest
          .fn()
          .mockResolvedValue(Object.entries(signals).map(([signal, n]) => ({ signal, _count: { _all: n } }))),
      },
      reviewRule: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
    return { service: new ReviewRulesService(prisma as never), prisma };
  };

  it(`learns a rule once a kind of finding is dismissed ${LEARN_THRESHOLD} times`, async () => {
    const { service, prisma } = setup({ down: 1, not_an_issue: 1 });
    await service.learn(owner, 'acme/api', 'logic:fp', 'Missing null check', 'Logic');
    expect(prisma.reviewRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        organizationId: 'org1',
        repo: 'acme/api',
        kind: 'suppress',
        source: 'learned',
        fingerprint: 'logic:fp',
        evidence: 2,
        text: 'Missing null check (Logic)',
      }),
    });
  });

  it("doesn't learn from one dismissal, or when the team found it useful as often", async () => {
    const one = setup({ down: 1 });
    await one.service.learn(owner, 'acme/api', 'fp', 't', 'Logic');
    expect(one.prisma.reviewRule.create).not.toHaveBeenCalled();
    const mixed = setup({ down: 2, up: 1, resolved: 1 });
    await mixed.service.learn(owner, 'acme/api', 'fp', 't', 'Logic');
    expect(mixed.prisma.reviewRule.create).not.toHaveBeenCalled();
  });

  it('forgets a learned rule once its evidence is withdrawn', async () => {
    const { service, prisma } = setup({ down: 1 }, { id: 'r1' });
    await service.learn(owner, 'acme/api', 'fp', 't', 'Logic');
    expect(prisma.reviewRule.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });

  it('keeps an existing learned rule’s evidence current instead of duplicating it', async () => {
    const { service, prisma } = setup({ down: 3 }, { id: 'r1' });
    await service.learn(owner, 'acme/api', 'fp', 't', 'Logic');
    expect(prisma.reviewRule.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { evidence: 3 } });
    expect(prisma.reviewRule.create).not.toHaveBeenCalled();
  });
});
