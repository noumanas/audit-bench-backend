import { AdminService } from './admin.service';

const target = (over: Record<string, unknown> = {}) => ({
  id: 'u2',
  email: 'dev@acme.com',
  role: 'user',
  organizationId: null,
  orgRole: null,
  ...over,
});

const setup = (user: ReturnType<typeof target> | null, teammates = 0) => {
  const db = {
    organizationInvite: { deleteMany: jest.fn() },
    planRequest: { updateMany: jest.fn() },
    user: { update: jest.fn(), delete: jest.fn() },
    organization: { delete: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user), count: jest.fn().mockResolvedValue(teammates) },
    $transaction: jest.fn((fn: (d: typeof db) => unknown) => fn(db)),
  };
  const service = new AdminService(prisma as never, {} as never, {} as never, { get: () => undefined } as never);
  return { service, db };
};

describe('AdminService.deleteUser', () => {
  it('deletes the user once their email is typed to confirm', async () => {
    const { service, db } = setup(target());
    await expect(service.deleteUser('admin1', 'u2', ' DEV@acme.com ')).resolves.toEqual({ deleted: true });
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'u2' } });
  });

  it('refuses without the right confirmation email', async () => {
    const { service, db } = setup(target());
    await expect(service.deleteUser('admin1', 'u2', 'other@acme.com')).rejects.toThrow(/Type the user’s email/);
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it('never deletes your own account or a super admin', async () => {
    await expect(setup(target()).service.deleteUser('u2', 'u2', 'dev@acme.com')).rejects.toThrow(/own account/);
    const { service, db } = setup(target({ role: 'super_admin' }));
    await expect(service.deleteUser('admin1', 'u2', 'dev@acme.com')).rejects.toThrow(/Super admins/);
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it('refuses a team owner who still has members, and removes a sole owner’s team with them', async () => {
    const owner = target({ organizationId: 'org1', orgRole: 'owner' });
    await expect(setup(owner, 3).service.deleteUser('admin1', 'u2', 'dev@acme.com')).rejects.toThrow(/owns a team/);
    const { service, db } = setup(owner, 0);
    await service.deleteUser('admin1', 'u2', 'dev@acme.com');
    expect(db.organization.delete).toHaveBeenCalledWith({ where: { id: 'org1' } });
    expect(db.user.delete).toHaveBeenCalled();
  });

  it('never deletes the built-in public-scan account', async () => {
    const system = target({ email: 'public-scans@system.auditbenchai.local' });
    const { service, db } = setup(system);
    await expect(service.deleteUser('admin1', 'u2', system.email)).rejects.toThrow(/built-in account/);
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it('404s for a user that does not exist', async () => {
    await expect(setup(null).service.deleteUser('admin1', 'nope', 'x@y.com')).rejects.toThrow(/not found/);
  });
});
