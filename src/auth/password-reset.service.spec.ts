import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { MAX_CODE_ATTEMPTS, PasswordResetService, RESEND_COOLDOWN_MS } from './password-reset.service';
import { JwtStrategy } from './jwt.strategy';

const ctx = { ip: null, userAgent: null, countryCode: null, region: null, city: null } as any;

/** A tiny in-memory stand-in for the two tables the service touches. */
function setup(userOverrides: Record<string, unknown> = {}) {
  const user: any = {
    id: 'u1', email: 'dev@acme.io', name: 'Dev', isActive: true, passwordHash: 'old',
    passwordChangedAt: null, plan: {}, organization: null, ...userOverrides,
  };
  let reset: any = null;
  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.email === user.email ? { ...user, passwordReset: reset ? { ...reset } : null } : null,
      ),
      update: jest.fn(async ({ data }: any) => Object.assign(user, data)),
    },
    passwordReset: {
      findUnique: jest.fn(async () => (reset ? { ...reset } : null)),
      upsert: jest.fn(async ({ create, update }: any) => (reset = reset ? { ...reset, ...update } : { ...create })),
      update: jest.fn(async ({ data }: any) => (reset = { ...reset, ...data })),
      delete: jest.fn(async () => (reset = null)),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const sent: { to: string; subject: string; text: string }[] = [];
  const email: any = { send: jest.fn(async (to: string, subject: string, _h: string, text: string) => sent.push({ to, subject, text })) };
  const config: any = { get: (k: string) => ({ JWT_SECRET: 'x'.repeat(40), FRONTEND_ORIGIN: 'https://auditbenchai.com' })[k] };
  const auth: any = { buildSession: jest.fn(() => ({ accessToken: 'jwt', user: { id: user.id } })) };
  const activity: any = { log: jest.fn() };
  const service = new PasswordResetService(prisma, email, config, auth, activity);
  const codeFromEmail = () => /code is: (\d{6})/.exec(sent[sent.length - 1].text)![1];
  return { service, prisma, user, sent, auth, activity, getReset: () => reset, setReset: (r: any) => (reset = r), codeFromEmail };
}

describe('PasswordResetService', () => {
  it('emails a 6-digit code and stores only a hash of it', async () => {
    const t = setup();
    await expect(t.service.requestCode('dev@acme.io')).resolves.toEqual({ ok: true });
    await new Promise(setImmediate);
    expect(t.sent).toHaveLength(1);
    const code = t.codeFromEmail();
    expect(t.sent[0].subject).toContain(code);
    expect(t.getReset().codeHash).not.toContain(code);
    expect(t.getReset().codeHash).toHaveLength(64);
  });

  it('answers the same way for an unknown or suspended email, without sending anything', async () => {
    const t = setup({ isActive: false });
    await expect(t.service.requestCode('nobody@acme.io')).resolves.toEqual({ ok: true });
    await expect(t.service.requestCode('dev@acme.io')).resolves.toEqual({ ok: true });
    expect(t.sent).toHaveLength(0);
    expect(t.getReset()).toBeNull();
  });

  it('does not send another code within the cooldown', async () => {
    const t = setup();
    await t.service.requestCode('dev@acme.io');
    await t.service.requestCode('dev@acme.io');
    await new Promise(setImmediate);
    expect(t.sent).toHaveLength(1);

    t.setReset({ ...t.getReset(), sentAt: new Date(Date.now() - RESEND_COOLDOWN_MS - 1) });
    await t.service.requestCode('dev@acme.io');
    await new Promise(setImmediate);
    expect(t.sent).toHaveLength(2);
  });

  it('trades the right code for a reset token, and the code then stops working', async () => {
    const t = setup();
    await t.service.requestCode('dev@acme.io');
    await new Promise(setImmediate);
    const code = t.codeFromEmail();
    const { resetToken } = await t.service.verifyCode('dev@acme.io', code);
    expect(resetToken.length).toBeGreaterThan(30);
    expect(t.getReset().codeHash).toBeNull();
    await expect(t.service.verifyCode('dev@acme.io', code)).rejects.toThrow(BadRequestException);
  });

  it('cancels the attempt after too many wrong codes', async () => {
    const t = setup();
    await t.service.requestCode('dev@acme.io');
    await new Promise(setImmediate);
    const right = t.codeFromEmail();
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      await expect(t.service.verifyCode('dev@acme.io', wrong)).rejects.toThrow('invalid or has expired');
    }
    await expect(t.service.verifyCode('dev@acme.io', wrong)).rejects.toThrow('Too many wrong codes');
    expect(t.getReset()).toBeNull();
    // Even the right code is useless now; a new one must be requested.
    await expect(t.service.verifyCode('dev@acme.io', right)).rejects.toThrow(BadRequestException);
  });

  it('rejects an expired code', async () => {
    const t = setup();
    await t.service.requestCode('dev@acme.io');
    await new Promise(setImmediate);
    t.setReset({ ...t.getReset(), codeExpiresAt: new Date(Date.now() - 1000) });
    await expect(t.service.verifyCode('dev@acme.io', t.codeFromEmail())).rejects.toThrow(BadRequestException);
  });

  it('sets the new password with the token, signs the user in and emails a notice', async () => {
    const t = setup();
    await t.service.requestCode('dev@acme.io');
    await new Promise(setImmediate);
    const { resetToken } = await t.service.verifyCode('dev@acme.io', t.codeFromEmail());

    const session = await t.service.resetPassword('dev@acme.io', resetToken, 'a-new-password', ctx);
    await new Promise(setImmediate);
    expect(session).toEqual({ accessToken: 'jwt', user: { id: 'u1' } });
    expect(await bcrypt.compare('a-new-password', t.user.passwordHash)).toBe(true);
    expect(t.user.passwordChangedAt).toBeInstanceOf(Date);
    expect(t.getReset()).toBeNull();
    expect(t.activity.log).toHaveBeenCalledWith(expect.objectContaining({ type: 'password_reset', userId: 'u1' }));
    expect(t.sent[t.sent.length - 1].subject).toBe('Your Audit Bench Ai password was changed');
    // The token was spent with the reset.
    await expect(t.service.resetPassword('dev@acme.io', resetToken, 'another-password', ctx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a wrong or expired reset token', async () => {
    const t = setup();
    await t.service.requestCode('dev@acme.io');
    await new Promise(setImmediate);
    const { resetToken } = await t.service.verifyCode('dev@acme.io', t.codeFromEmail());
    await expect(t.service.resetPassword('dev@acme.io', 'x'.repeat(43), 'a-new-password', ctx)).rejects.toThrow(
      BadRequestException,
    );
    t.setReset({ ...t.getReset(), resetTokenExpiresAt: new Date(Date.now() - 1000) });
    await expect(t.service.resetPassword('dev@acme.io', resetToken, 'a-new-password', ctx)).rejects.toThrow(
      BadRequestException,
    );
    expect(t.user.passwordHash).toBe('old');
  });
});

describe('JwtStrategy after a password reset', () => {
  const strategyFor = (passwordChangedAt: Date | null) => {
    const prisma: any = {
      user: {
        findUnique: async () => ({ id: 'u1', email: 'dev@acme.io', role: 'user', organizationId: null, isActive: true, passwordChangedAt }),
      },
    };
    const config: any = { get: () => 'x'.repeat(40) };
    return new JwtStrategy(config, prisma);
  };

  it('rejects sessions issued before the password changed and accepts newer ones', async () => {
    const changedAt = new Date('2026-11-08T12:00:00Z');
    const strategy = strategyFor(changedAt);
    const before = Math.floor(changedAt.getTime() / 1000) - 60;
    const after = Math.floor(changedAt.getTime() / 1000);
    await expect(strategy.validate({ sub: 'u1', email: 'dev@acme.io', iat: before })).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(strategy.validate({ sub: 'u1', email: 'dev@acme.io', iat: after })).resolves.toMatchObject({ id: 'u1' });
  });

  it('leaves sessions alone for accounts that never reset', async () => {
    await expect(strategyFor(null).validate({ sub: 'u1', email: 'dev@acme.io', iat: 1 })).resolves.toMatchObject({
      id: 'u1',
    });
  });
});
