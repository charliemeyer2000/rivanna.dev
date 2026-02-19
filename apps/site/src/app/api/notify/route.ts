import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createHmac } from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);
const HMAC_SECRET = process.env.NOTIFY_HMAC_SECRET!;
const FROM = "rv <noreply@rivanna.dev>";
const COMPUTING_ID_RE = /^[a-z]{2,3}\d[a-z]{2,3}$/;
const VALID_EVENTS = ["STARTED", "COMPLETED", "FAILED", "RESUBMITTED"];
const TIMESTAMP_WINDOW_S = 600; // 10 minutes

// In-memory rate limiter (resets on deploy — acceptable for this use case)
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 3_600_000; // 1 hour

function checkRate(user: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(user);
  if (!entry || now > entry.resetAt) {
    rateMap.set(user, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function verifyHmac(
  user: string,
  jobId: string,
  event: string,
  epoch: number,
  sig: string,
): boolean {
  const payload = `${user}:${jobId}:${event}:${epoch}`;
  const expected = createHmac("sha256", HMAC_SECRET)
    .update(payload)
    .digest("hex");
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user, jobId, jobName, event, node, ts, epoch, sig } = body;

    if (!user || !jobId || !jobName || !event || !epoch || !sig) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if (!COMPUTING_ID_RE.test(user)) {
      return NextResponse.json({ error: "Invalid user" }, { status: 400 });
    }

    if (!VALID_EVENTS.includes(event)) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    if (!verifyHmac(user, jobId, event, epoch, sig)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - epoch) > TIMESTAMP_WINDOW_S) {
      return NextResponse.json({ error: "Expired" }, { status: 403 });
    }

    if (!checkRate(user)) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const to = `${user}@virginia.edu`;
    const subject = buildSubject(event, jobName, node);
    const html = buildEmail(event, jobId, jobName, node, ts);

    await resend.emails.send({ from: FROM, to, subject, html });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Notify error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function buildSubject(event: string, jobName: string, node?: string): string {
  switch (event) {
    case "STARTED":
      return `rv: ${jobName} started${node ? ` on ${node}` : ""}`;
    case "COMPLETED":
      return `rv: ${jobName} completed`;
    case "FAILED":
      return `rv: ${jobName} failed`;
    case "RESUBMITTED":
      return `rv: ${jobName} resubmitted (checkpoint)`;
    default:
      return `rv: ${jobName} — ${event.toLowerCase()}`;
  }
}

function buildEmail(
  event: string,
  jobId: string,
  jobName: string,
  node?: string,
  ts?: string,
): string {
  const time = ts
    ? new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York" })
    : "unknown";
  const statusColor =
    event === "COMPLETED"
      ? "#22c55e"
      : event === "FAILED"
        ? "#ef4444"
        : event === "RESUBMITTED"
          ? "#f59e0b"
          : "#3b82f6";

  return `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <div style="border-left:4px solid ${statusColor};padding-left:16px;margin-bottom:16px">
    <h2 style="margin:0 0 4px;font-size:18px">${jobName}</h2>
    <span style="color:${statusColor};font-weight:600;font-size:14px">${event}</span>
  </div>
  <table style="font-size:14px;color:#555;border-collapse:collapse">
    <tr><td style="padding:4px 16px 4px 0;color:#999">Job ID</td><td>${jobId}</td></tr>
    ${node ? `<tr><td style="padding:4px 16px 4px 0;color:#999">Node</td><td>${node}</td></tr>` : ""}
    <tr><td style="padding:4px 16px 4px 0;color:#999">Time</td><td>${time}</td></tr>
  </table>
  <p style="margin-top:20px;font-size:12px;color:#999">
    Sent by <a href="https://rivanna.dev" style="color:#999">rv</a> — disable in ~/.rv/config.toml
  </p>
</div>`;
}
