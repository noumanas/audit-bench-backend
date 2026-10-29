import { promises as dns } from 'dns';

/**
 * Domains that can never receive mail (RFC 2606 / RFC 6761): test and
 * documentation addresses such as "qa-123@example.com".
 */
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org', 'localhost']);
const RESERVED_TLDS = new Set(['example', 'test', 'invalid', 'localhost', 'local']);

/** Common throwaway-inbox services. Not exhaustive: the DNS check catches made-up domains. */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'sharklasers.com',
  'grr.la',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  'tempmail.dev',
  'tempmailo.com',
  'tempail.com',
  'yopmail.com',
  'yopmail.net',
  'yopmail.fr',
  'trashmail.com',
  'trashmail.de',
  'maildrop.cc',
  'getnada.com',
  'nada.email',
  'dispostable.com',
  'throwawaymail.com',
  'fakeinbox.com',
  'mintemail.com',
  'mohmal.com',
  'emailondeck.com',
  'moakt.com',
  'mailnesia.com',
  'mailcatch.com',
  'spamgourmet.com',
  'getairmail.com',
  'discard.email',
  'burnermail.io',
  'mail.tm',
  'inboxkitten.com',
]);

const DNS_TIMEOUT_MS = 3000;

export interface MxResolver {
  resolveMx(domain: string): Promise<Array<{ exchange: string }>>;
  resolve4(domain: string): Promise<string[]>;
}

/** Why an address can't be used to sign up, or null if it looks real. Never throws. */
export async function unusableEmailReason(email: string, resolver: MxResolver = dns): Promise<string | null> {
  const domain = email.split('@').pop()?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  if (!domain || !domain.includes('.')) return 'Use a real email address.';

  const tld = domain.split('.').pop() as string;
  if (
    RESERVED_DOMAINS.has(domain) ||
    RESERVED_TLDS.has(tld) ||
    [...RESERVED_DOMAINS].some((d) => domain.endsWith(`.${d}`))
  ) {
    return 'Use a real email address — test addresses like example.com can’t receive mail.';
  }
  if (DISPOSABLE_DOMAINS.has(domain) || [...DISPOSABLE_DOMAINS].some((d) => domain.endsWith(`.${d}`))) {
    return 'Disposable email addresses aren’t accepted. Use your work or personal email.';
  }

  return (await canReceiveMail(domain, resolver))
    ? null
    : `The domain "${domain}" can’t receive email. Check the address.`;
}

/**
 * Whether the domain has somewhere to deliver mail: MX records, or failing
 * that an address record (mail's implicit MX). Fails open on timeouts and
 * DNS errors other than "no such domain / no records", so a slow resolver
 * never blocks a real person.
 */
async function canReceiveMail(domain: string, resolver: MxResolver): Promise<boolean> {
  const verdict = async (): Promise<boolean> => {
    try {
      const mx = await resolver.resolveMx(domain);
      if (mx.some((r) => r.exchange && r.exchange !== '.')) return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOTFOUND') return false;
      if (code !== 'ENODATA') return true;
    }
    try {
      return (await resolver.resolve4(domain)).length > 0;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return !(code === 'ENOTFOUND' || code === 'ENODATA');
    }
  };
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), DNS_TIMEOUT_MS).unref());
  return Promise.race([verdict(), timeout]);
}
