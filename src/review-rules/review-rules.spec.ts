import {
  ReviewRulesService,
  repoFromSourceName,
  repoRulesFile,
  rulesPromptText,
  withRulesFile,
  LEARN_THRESHOLD,
  NO_RULES,
} from './review-rules.service';

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

describe('auditbench.md', () => {
  it('reads the rules file from the repo root, a dotfile, or .github, in that order', () => {
    expect(repoRulesFile([{ path: 'src/a.ts', content: 'x' }])).toBeNull();
    expect(repoRulesFile([{ path: '.github/auditbench.md', content: ' Use tabs. ' }])).toBe('Use tabs.');
    expect(
      repoRulesFile([
        { path: '.github/auditbench.md', content: 'second' },
        { path: 'AuditBench.md', content: 'first' },
      ]),
    ).toBe('first');
  });

  it('adds it to the prompt rules and changes the cache key', () => {
    const merged = withRulesFile(NO_RULES, 'We use tabs.');
    expect(rulesPromptText(merged)).toContain("From the repository's auditbench.md:\nWe use tabs.");
    expect(merged.key).not.toBe('');
    expect(withRulesFile(NO_RULES, 'Something else.').key).not.toBe(merged.key);
    expect(withRulesFile(NO_RULES, null)).toBe(NO_RULES);
  });
});

describe('ReviewRulesService.outcomes', () => {
  it('totals accepted, dismissed and ignored findings overall and by category', async () => {
    const prisma = {
      findingFeedback: {
        groupBy: jest.fn().mockResolvedValue([
          { category: 'Security', signal: 'accepted', _count: { _all: 3 } },
          { category: 'Security', signal: 'ignored', _count: { _all: 1 } },
          { category: 'Testing', signal: 'dismissed', _count: { _all: 2 } },
        ]),
      },
    };
    const out = await new ReviewRulesService(prisma as never).outcomes({ id: 'u1', organizationId: null });
    expect(out.total).toEqual({ accepted: 3, dismissed: 2, ignored: 1, total: 6 });
    expect(out.byCategory.Security).toEqual({ accepted: 3, dismissed: 0, ignored: 1, total: 4 });
    expect(prisma.findingFeedback.groupBy.mock.calls[0][0].where).toMatchObject({ source: 'outcome', userId: 'u1', organizationId: null });
  });
});
