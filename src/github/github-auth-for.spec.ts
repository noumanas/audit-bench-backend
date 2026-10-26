import { BadRequestException } from '@nestjs/common';
import { GithubService } from './github.service';

describe('GithubService.authFor', () => {
  const service = (user: { githubToken: string | null }, installations: Array<{ id: number; accountLogin: string }>) =>
    new GithubService(
      {
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) },
        githubInstallation: { findMany: jest.fn().mockResolvedValue(installations) },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('uses the connected token when there is one', async () => {
    await expect(service({ githubToken: 'enc' }, []).authFor('u1', 'acme')).resolves.toBe('u1');
  });

  it('falls back to the App installation on that account, ignoring case', async () => {
    const s = service({ githubToken: null }, [{ id: 9, accountLogin: 'Acme' }]);
    await expect(s.authFor('u1', 'acme')).resolves.toEqual({ installationId: 9 });
  });

  it('explains what to install when nothing reaches the repository', async () => {
    const s = service({ githubToken: null }, [{ id: 9, accountLogin: 'other' }]);
    await expect(s.authFor('u1', 'acme')).rejects.toThrow(BadRequestException);
    await expect(s.authFor('u1', 'acme')).rejects.toThrow(/isn't installed on acme/);
  });
});
