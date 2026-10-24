import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { WelcomeEmailService } from './welcome-email.service';
import { welcomeEmail } from './templates';

const FREE = { id: 'p-free', name: 'Free', monthlyAuditLimit: 20, maxRepositories: 1 };

describe('welcomeEmail template', () => {
  it('greets by name, states the plan limits and links the three first steps', () => {
    const msg = welcomeEmail({ name: 'Sam <x>', appOrigin: 'https://app.x', plan: FREE });
    expect(msg.subject).toBe('Welcome to Audit Bench Ai — your account is ready');
    expect(msg.html).toContain('Hi Sam &lt;x&gt;,');
    expect(msg.html).toContain('20 audits a month and 1 repository');
    for (const path of ['/app', '/app/repository', '/app/rules']) expect(msg.html).toContain(`href="https://app.x${path}"`);
    // Transactional — no unsubscribe link.
    expect(msg.html).not.toContain('Unsubscribe');
    expect(msg.text).toContain('You\'re on the Free plan — 20 audits a month and 1 repository');
  });

  it('handles an unlimited plan and a missing name', () => {
    const msg = welcomeEmail({ name: null, appOrigin: 'https://app.x', plan: { name: 'Pro', monthlyAuditLimit: null, maxRepositories: null } });
    expect(msg.html).toContain('Hi there,');
    expect(msg.html).toContain("You're on the <strong>Pro</strong> plan.");
  });
});

describe('WelcomeEmailService', () => {
  it('never throws when the send fails — signup must not depend on mail', async () => {
    const email = { send: jest.fn().mockRejectedValue(new Error('535 auth')) };
    const service = new WelcomeEmailService(email as never, new ConfigService({}));
    expect(() => service.send({ email: 'a@x.com', name: null, plan: FREE })).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(email.send).toHaveBeenCalledWith('a@x.com', expect.any(String), expect.any(String), expect.any(String));
  });
});

describe('AuthService.signup', () => {
  it('sends the welcome email for the new account', async () => {
    const user = {
      id: 'u1', email: 'new@x.com', name: 'New', createdAt: new Date(), plan: FREE,
      role: 'user', isActive: true, organizationId: null, orgRole: null, organization: null,
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue(user) },
      plan: { findUnique: jest.fn().mockResolvedValue(FREE) },
    };
    const welcome = { send: jest.fn() };
    const auth = new AuthService(prisma as never, { sign: () => 'jwt' } as never, new ConfigService({}), welcome as never);
    await auth.signup({ email: 'new@x.com', password: 'correct horse battery', name: 'New' });
    expect(welcome.send).toHaveBeenCalledWith(user);
  });

  it('does not send when the email is already registered', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }) } };
    const welcome = { send: jest.fn() };
    const auth = new AuthService(prisma as never, {} as never, new ConfigService({}), welcome as never);
    await expect(auth.signup({ email: 'a@x.com', password: 'correct horse battery', name: 'A' })).rejects.toThrow();
    expect(welcome.send).not.toHaveBeenCalled();
  });
});
