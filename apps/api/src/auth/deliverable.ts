import { resolve4, resolve6, resolveMx } from 'node:dns/promises';
import { HttpError } from '@/http';

/** DNS answers that mean "this name has no such record" rather than "DNS is having trouble". */
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);
const noRecord = (e: unknown) => NO_RECORD.has((e as { code?: string })?.code ?? '');

/**
 * Whether the email's domain can receive mail: it has MX records, or (as mail servers fall back
 * to) an address record. A "null MX" (RFC 7505) means the domain refuses all mail.
 *
 * Fails open: if DNS itself is unreachable we let the address through, because blocking real
 * people during a DNS hiccup is worse than one bounced code.
 *
 * This can't prove that the mailbox itself exists. Mail providers no longer answer that
 * reliably; the emailed code is what proves it.
 */
async function domainAcceptsMail(domain: string): Promise<boolean> {
  try {
    const mx = await resolveMx(domain);
    if (mx.length > 0) return !mx.every((r) => r.exchange === '' || r.exchange === '.');
  } catch (e) {
    if (!noRecord(e)) return true;
  }
  for (const lookup of [resolve4, resolve6]) {
    try {
      if ((await lookup(domain)).length > 0) return true;
    } catch (e) {
      if (!noRecord(e)) return true;
    }
  }
  return false;
}

let checker = domainAcceptsMail;

/** For tests only. */
export function setDomainCheckerForTests(fn: typeof domainAcceptsMail | null) {
  checker = fn ?? domainAcceptsMail;
}

export async function assertDeliverable(email: string) {
  const domain = email.split('@')[1] ?? '';
  if (!(await checker(domain))) {
    throw new HttpError(
      400,
      'EMAIL_UNDELIVERABLE',
      `We can't send email to ${domain}. Check the address for typos.`,
    );
  }
}
