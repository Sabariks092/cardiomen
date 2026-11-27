/** Checks done on the phone before anything is sent. The server checks again, including DNS. */

const FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** A message for an email that can't be right, or null. */
export function emailProblem(email: string): string | null {
  const e = normalizeEmail(email);
  if (!e) return 'Enter your email.';
  if (!FORMAT.test(e)) return 'That email doesn\'t look right. Check it for typos.';
  return null;
}

/** Common misspellings of popular mail domains. These domains can be real, so it's only a hint. */
const TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.in': 'gmail.com',
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com',
  'icloud.con': 'icloud.com',
};

/** The corrected address when the domain looks like a typo, e.g. name@gmial.com → name@gmail.com. */
export function emailSuggestion(email: string): string | null {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const fix = TYPOS[e.slice(at + 1)];
  return fix ? `${e.slice(0, at)}@${fix}` : null;
}
