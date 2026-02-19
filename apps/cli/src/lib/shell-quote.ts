/**
 * POSIX-safe shell quoting, equivalent to Python's shlex.quote().
 *
 * Wraps strings in single quotes, which prevents all shell interpretation
 * ($, `, \, !, etc.). Embedded single quotes are escaped by ending the
 * quoted segment, adding a backslash-escaped single quote, and starting
 * a new quoted segment: can't → 'can'\''t'
 */
const SAFE_CHARS = /^[a-zA-Z0-9_@%+=:,./-]+$/;

export function shellQuote(s: string): string {
  if (s === "") return "''";
  if (SAFE_CHARS.test(s)) return s;
  return "'" + s.replaceAll("'", "'\\''") + "'";
}

export function shellJoin(args: string[]): string {
  return args.map(shellQuote).join(" ");
}
