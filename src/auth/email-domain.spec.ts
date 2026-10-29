import { unusableEmailReason } from './email-domain';

const err = (code: string) => Object.assign(new Error(code), { code });
const resolver = (
  mx: () => Promise<Array<{ exchange: string }>>,
  a: () => Promise<string[]> = () => Promise.reject(err('ENODATA')),
) => ({
  resolveMx: jest.fn(mx),
  resolve4: jest.fn(a),
});
const hasMx = resolver(() => Promise.resolve([{ exchange: 'mx.acme.com' }]));

describe('unusableEmailReason', () => {
  it('rejects reserved test domains without touching DNS', async () => {
    for (const email of [
      'qa-1793229469377-74553b@example.com',
      'a@example.org',
      'a@sub.example.net',
      'a@foo.test',
      'a@foo.invalid',
      'a@localhost',
    ]) {
      expect(await unusableEmailReason(email, hasMx)).toMatch(/real email address/);
    }
    expect(hasMx.resolveMx).not.toHaveBeenCalled();
  });

  it('rejects throwaway inbox services', async () => {
    expect(await unusableEmailReason('x@mailinator.com', hasMx)).toMatch(/Disposable/);
    expect(await unusableEmailReason('x@YOPmail.com', hasMx)).toMatch(/Disposable/);
  });

  it('rejects a domain that does not exist or has nowhere to deliver mail', async () => {
    expect(
      await unusableEmailReason(
        'a@no-such-domain-xyz.com',
        resolver(() => Promise.reject(err('ENOTFOUND'))),
      ),
    ).toMatch(/can’t receive email/);
    expect(
      await unusableEmailReason(
        'a@parked.com',
        resolver(() => Promise.reject(err('ENODATA'))),
      ),
    ).toMatch(/can’t receive email/);
  });

  it('accepts a real domain: MX records, or an address record when there is no MX', async () => {
    expect(await unusableEmailReason('dev@acme.com', hasMx)).toBeNull();
    expect(
      await unusableEmailReason(
        'dev@small.co',
        resolver(
          () => Promise.reject(err('ENODATA')),
          () => Promise.resolve(['1.2.3.4']),
        ),
      ),
    ).toBeNull();
  });

  it('never blocks a real person because DNS is slow or failing', async () => {
    expect(
      await unusableEmailReason(
        'dev@acme.com',
        resolver(() => Promise.reject(err('ETIMEOUT'))),
      ),
    ).toBeNull();
    expect(
      await unusableEmailReason(
        'dev@acme.com',
        resolver(() => Promise.reject(err('ESERVFAIL'))),
      ),
    ).toBeNull();
  });
});
