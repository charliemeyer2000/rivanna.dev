/**
 * Parse sshare output to extract fairshare score (0-1).
 * Expected format: `sshare -u <user> -l`
 *
 * Real output columns:
 *   Account  User  RawShares  NormShares  RawUsage  NormUsage  EffectvUsage  FairShare  LevelFS  GrpTRESMins  TRESRunMins
 *
 * User-specific row example:
 *   meng-lab  abs6bd  1  0.142857  44205  0.000000  0.000039  0.161731  3.6506e+03  ...
 *
 * FairShare is column index 7 (0-based). We find the row where User column
 * is populated (not blank) and extract FairShare from it.
 */
export function parseSshare(output: string): number {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Account") || trimmed.startsWith("-"))
      continue;

    const parts = trimmed.split(/\s+/);
    // User-specific rows have Account AND User filled in (at least 8 columns)
    // Account rows without user have the User column empty, shifting columns.
    // When User is present: parts[0]=Account, parts[1]=User, ..., parts[7]=FairShare
    if (parts.length < 8) continue;

    // Check if column 1 looks like a username (not a number, not empty)
    const possibleUser = parts[1]!;
    if (
      possibleUser &&
      !/^\d/.test(possibleUser) &&
      possibleUser !== "-" &&
      !possibleUser.includes("=")
    ) {
      // This is a user row — FairShare is at index 7
      const fairshare = Number.parseFloat(parts[7]!);
      if (!Number.isNaN(fairshare) && fairshare >= 0 && fairshare <= 1) {
        return fairshare;
      }
    }
  }

  return 0.5;
}
