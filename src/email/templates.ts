/**
 * Branded email templates. Email clients ignore <style> blocks and most
 * modern CSS, so everything here is table layout + inline styles; colors are
 * the site's ink/paper/cobalt palette (see front-end globals.css).
 *
 * Every template returns subject + html + a plain-text alternative, and
 * escapes anything user-supplied (names, org names, admin notes).
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const C = {
  ink: '#10141c',
  paper: '#f2f3ee',
  card: '#ffffff',
  line: '#dde0d8',
  muted: '#6b7280',
  cobalt: '#2b5be3',
  pass: '#1f7a4d',
  critical: '#c92a3d',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
  <tr><td style="border-radius:8px;background:${C.cobalt};">
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink};">${html}</p>`;
}

interface LayoutOptions {
  /** Inbox preview text — shown next to the subject, hidden in the body. */
  preheader: string;
  heading: string;
  bodyHtml: string;
  /** Small print under the card — why they got this email. */
  footerNote: string;
  unsubscribeUrl?: string;
}

function layout({ preheader, heading, bodyHtml, footerNote, unsubscribeUrl }: LayoutOptions): string {
  const unsubscribe = unsubscribeUrl
    ? ` · <a href="${escapeHtml(unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 20px;font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:-0.2px;color:${C.ink};">
        audit<span style="color:${C.cobalt};">/</span>bench <span style="font-weight:500;color:${C.muted};">ai</span>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:12px;padding:36px 32px;">
        <h1 style="margin:0 0 20px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${C.ink};">${escapeHtml(heading)}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:20px 4px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">
        ${footerNote}<br>
        Audit Bench Ai · AI code review for every pull request${unsubscribe}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function textFooter(footerNote: string, unsubscribeUrl?: string): string {
  return `\n\n—\n${footerNote}\nAudit Bench Ai${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ''}`;
}

/** The subset of a Plan row the comparison table reads. */
export interface PlanLimits {
  name: string;
  priceMonthlyCents: number;
  monthlyAuditLimit: number | null;
  maxRepositories: number | null;
  monthlyRepoScanLimit: number | null;
}

export interface UpgradeEmailInput {
  name: string | null;
  free: PlanLimits;
  pro: PlanLimits;
  pricingUrl: string;
  unsubscribeUrl: string;
  /** Usage this calendar month, if known — makes the nudge concrete. */
  auditsUsed?: number;
  auditLimit?: number | null;
}

/** Weekly nudge to Free-plan users — see UpgradeEmailService. */
export function upgradeEmail(input: UpgradeEmailInput): RenderedEmail {
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : 'Hi there,';
  const usage =
    input.auditsUsed !== undefined && input.auditLimit
      ? paragraph(
          `This month you've run <strong>${input.auditsUsed} of ${input.auditLimit}</strong> audits on the Free plan.`,
        )
      : '';

  const { free, pro } = input;
  const limit = (n: number | null) => (n === null ? 'Unlimited' : n.toLocaleString('en-US'));
  const proPrice = `$${(pro.priceMonthlyCents / 100).toFixed(0)}/mo`;
  const rows: [string, string, string][] = [
    ['Audits per month', limit(free.monthlyAuditLimit), limit(pro.monthlyAuditLimit)],
    ['Repositories', limit(free.maxRepositories), limit(pro.maxRepositories)],
    ['Full repo scans / month', limit(free.monthlyRepoScanLimit), limit(pro.monthlyRepoScanLimit)],
  ];
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;border:1px solid ${C.line};border-radius:8px;border-collapse:separate;">
  <tr>
    <td style="padding:10px 14px;font-family:${FONT};font-size:12px;font-weight:600;color:${C.muted};border-bottom:1px solid ${C.line};"></td>
    <td style="padding:10px 14px;font-family:${FONT};font-size:12px;font-weight:600;color:${C.muted};border-bottom:1px solid ${C.line};" align="center">${escapeHtml(free.name)}</td>
    <td style="padding:10px 14px;font-family:${FONT};font-size:12px;font-weight:700;color:${C.cobalt};border-bottom:1px solid ${C.line};" align="center">${escapeHtml(pro.name)} · ${proPrice}</td>
  </tr>
  ${rows
    .map(
      ([label, free, pro], i) => `<tr>
    <td style="padding:10px 14px;font-family:${FONT};font-size:14px;color:${C.ink};${i < rows.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}">${label}</td>
    <td style="padding:10px 14px;font-family:${FONT};font-size:14px;color:${C.muted};${i < rows.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}" align="center">${free}</td>
    <td style="padding:10px 14px;font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink};${i < rows.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}" align="center">${pro}</td>
  </tr>`,
    )
    .join('')}
</table>`;

  const footerNote = "You're getting this weekly because you're on the Audit Bench Ai Free plan.";
  const html = layout({
    preheader: `More audits, more repositories, and PR reviews that keep up with your team — from ${proPrice}.`,
    heading: `Ship with more confidence on ${pro.name}`,
    bodyHtml:
      paragraph(greeting) +
      usage +
      paragraph(
        `${escapeHtml(free.name)} is great for trying Audit Bench on a single repo. ${escapeHtml(pro.name)} lifts the limits so every pull request across all your projects gets an AI review before it merges.`,
      ) +
      table +
      button('See plans & upgrade', input.pricingUrl) +
      `<p style="margin:16px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};">Working with a team? The Team plan pools audits across everyone in your workspace.</p>`,
    footerNote,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  const text =
    `${input.name ? `Hi ${input.name},` : 'Hi there,'}\n\n` +
    (input.auditsUsed !== undefined && input.auditLimit
      ? `This month you've run ${input.auditsUsed} of ${input.auditLimit} audits on the Free plan.\n\n`
      : '') +
    `${free.name} is great for trying Audit Bench on a single repo. ${pro.name} lifts the limits so every pull request across all your projects gets an AI review before it merges.\n\n` +
    rows.map(([l, f, p]) => `- ${l}: ${free.name} ${f} → ${pro.name} ${p}`).join('\n') +
    `\n${pro.name} is ${proPrice}.` +
    `\n\nSee plans & upgrade: ${input.pricingUrl}` +
    textFooter(footerNote, input.unsubscribeUrl);

  return { subject: `Get more out of Audit Bench Ai with ${pro.name}`, html, text };
}

export interface OrgInviteEmailInput {
  inviterName: string;
  orgName: string;
  acceptUrl: string;
}

export function orgInviteEmail({ inviterName, orgName, acceptUrl }: OrgInviteEmailInput): RenderedEmail {
  const footerNote = "You're getting this because someone invited this address to their workspace. If you weren't expecting it, you can ignore it.";
  const html = layout({
    preheader: `${inviterName} invited you to ${orgName} on Audit Bench Ai.`,
    heading: `Join ${orgName} on Audit Bench Ai`,
    bodyHtml:
      paragraph(
        `<strong>${escapeHtml(inviterName)}</strong> invited you to join <strong>${escapeHtml(orgName)}</strong>. You'll share audits, scans, and analytics with the rest of the team.`,
      ) +
      button('Accept invite', acceptUrl) +
      `<p style="margin:16px 0 0;font-family:${FONT};font-size:13px;color:${C.muted};">This link expires in 7 days.</p>`,
    footerNote,
  });
  const text =
    `${inviterName} invited you to join ${orgName} on Audit Bench Ai.\n\nAccept: ${acceptUrl}\n\nThis link expires in 7 days.` +
    textFooter(footerNote);
  return { subject: `You've been invited to join ${orgName} on Audit Bench Ai`, html, text };
}

export interface PlanDecisionEmailInput {
  name: string | null;
  planName: string;
  appUrl: string;
  /** For approvals: when the 30-day term ends. */
  expiresAt?: Date | null;
  /** For rejections: the admin's note, if any. */
  note?: string | null;
}

export function planApprovedEmail(input: PlanDecisionEmailInput): RenderedEmail {
  const expiry = input.expiresAt
    ? input.expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : null;
  const footerNote = "You're getting this because you requested a plan change on Audit Bench Ai.";
  const html = layout({
    preheader: `Your ${input.planName} plan is active.`,
    heading: `You're on ${input.planName} 🎉`,
    bodyHtml:
      paragraph(input.name ? `Hi ${escapeHtml(input.name)},` : 'Hi there,') +
      paragraph(
        `Your request for the <strong style="color:${C.pass};">${escapeHtml(input.planName)}</strong> plan was approved and the new limits apply right away.` +
          (expiry ? ` This term runs until <strong>${expiry}</strong>.` : ''),
      ) +
      button('Open Audit Bench', input.appUrl),
    footerNote,
  });
  const text =
    `${input.name ? `Hi ${input.name},` : 'Hi there,'}\n\nYour request for the ${input.planName} plan was approved and the new limits apply right away.` +
    (expiry ? ` This term runs until ${expiry}.` : '') +
    `\n\nOpen Audit Bench: ${input.appUrl}` +
    textFooter(footerNote);
  return { subject: `Your ${input.planName} plan is active`, html, text };
}

export function planRejectedEmail(input: PlanDecisionEmailInput): RenderedEmail {
  const footerNote = "You're getting this because you requested a plan change on Audit Bench Ai.";
  const noteHtml = input.note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;"><tr><td style="border-left:3px solid ${C.line};padding:4px 14px;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.ink};">${escapeHtml(input.note)}</td></tr></table>`
    : '';
  const html = layout({
    preheader: `An update on your ${input.planName} plan request.`,
    heading: `About your ${input.planName} request`,
    bodyHtml:
      paragraph(input.name ? `Hi ${escapeHtml(input.name)},` : 'Hi there,') +
      paragraph(`We weren't able to approve your request for the <strong>${escapeHtml(input.planName)}</strong> plan this time.`) +
      noteHtml +
      paragraph('Your current plan is unchanged. Reply to this email if you have questions — we read every one.') +
      button('View plans', input.appUrl),
    footerNote,
  });
  const text =
    `${input.name ? `Hi ${input.name},` : 'Hi there,'}\n\nWe weren't able to approve your request for the ${input.planName} plan this time.` +
    (input.note ? `\n\nNote from our team: ${input.note}` : '') +
    `\n\nYour current plan is unchanged. Reply to this email if you have questions.\n\nView plans: ${input.appUrl}` +
    textFooter(footerNote);
  return { subject: `Update on your ${input.planName} plan request`, html, text };
}

export interface InactivityEmailInput {
  name: string | null;
  daysInactive: number;
  /** Frontend origin — the quick-start links are paths under it. */
  appOrigin: string;
  unsubscribeUrl: string;
}

/** "We haven't seen you in a while" — see InactivityEmailService. */
export function inactivityEmail(input: InactivityEmailInput): RenderedEmail {
  const ideas: [string, string, string][] = [
    ['Review a pull request', 'Paste a PR or diff and get findings ranked by severity in under a minute.', '/app'],
    ['Scan a repository', 'Connect GitHub, GitLab or Bitbucket and audit a whole codebase.', '/app/repository'],
    ['Teach it your standards', 'Add review rules so every audit checks what your team cares about.', '/app/rules'],
  ];
  const ideaRows = ideas
    .map(
      ([title, body, path], i) => `<tr><td style="padding:14px 0;${i < ideas.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}">
    <a href="${escapeHtml(input.appOrigin + path)}" style="font-family:${FONT};font-size:15px;font-weight:600;color:${C.cobalt};text-decoration:none;">${title} →</a>
    <div style="margin-top:4px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.muted};">${body}</div>
  </td></tr>`,
    )
    .join('');
  const days = input.daysInactive === 1 ? '1 day' : `${input.daysInactive} days`;

  const footerNote = "You're getting this because you haven't used your Audit Bench Ai account in a while.";
  const html = layout({
    preheader: `It's been ${days} — here are three quick ways to put Audit Bench to work.`,
    heading: 'Your next pull request deserves a second look',
    bodyHtml:
      paragraph(input.name ? `Hi ${escapeHtml(input.name)},` : 'Hi there,') +
      paragraph(
        `It's been <strong>${days}</strong> since you last used Audit Bench. Bugs and security issues don't take a week off — here are three quick ways to pick up where you left off:`,
      ) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;">${ideaRows}</table>` +
      button('Open Audit Bench', `${input.appOrigin}/app`),
    footerNote,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  const text =
    `${input.name ? `Hi ${input.name},` : 'Hi there,'}\n\n` +
    `It's been ${days} since you last used Audit Bench. Here are three quick ways to pick up where you left off:\n\n` +
    ideas.map(([title, body, path]) => `- ${title}: ${body}\n  ${input.appOrigin}${path}`).join('\n') +
    `\n\nOpen Audit Bench: ${input.appOrigin}/app` +
    textFooter(footerNote, input.unsubscribeUrl);

  return { subject: 'Your code reviews are waiting on Audit Bench Ai', html, text };
}

export interface WelcomeEmailInput {
  name: string | null;
  /** Frontend origin — the step links are paths under it. */
  appOrigin: string;
  /** The plan the account starts on (Free for every self-serve signup). */
  plan: Pick<PlanLimits, 'name' | 'monthlyAuditLimit' | 'maxRepositories'>;
}

/** Sent once, right after an account is created — see WelcomeEmailService. */
export function welcomeEmail({ name, appOrigin, plan }: WelcomeEmailInput): RenderedEmail {
  const steps: [string, string, string][] = [
    ['Run your first audit', 'Paste a file, diff or pull request link and get findings ranked by severity.', '/app'],
    ['Connect a repository', 'Link GitHub, GitLab or Bitbucket to scan a whole codebase.', '/app/repository'],
    ['Set your review rules', 'Tell Audit Bench what your team cares about so every review checks it.', '/app/rules'],
  ];
  const stepRows = steps
    .map(
      ([title, body, path], i) => `<tr>
    <td width="36" valign="top" style="padding:14px 0;${i < steps.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}">
      <div style="width:26px;height:26px;line-height:26px;border-radius:13px;background:${C.paper};text-align:center;font-family:${FONT};font-size:13px;font-weight:700;color:${C.cobalt};">${i + 1}</div>
    </td>
    <td valign="top" style="padding:14px 0;${i < steps.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}">
      <a href="${escapeHtml(appOrigin + path)}" style="font-family:${FONT};font-size:15px;font-weight:600;color:${C.ink};text-decoration:none;">${title}</a>
      <div style="margin-top:4px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.muted};">${body}</div>
    </td>
  </tr>`,
    )
    .join('');

  const limits: string[] = [];
  if (plan.monthlyAuditLimit !== null) limits.push(`${plan.monthlyAuditLimit.toLocaleString('en-US')} audits a month`);
  if (plan.maxRepositories !== null) {
    limits.push(`${plan.maxRepositories} ${plan.maxRepositories === 1 ? 'repository' : 'repositories'}`);
  }
  const planLine = limits.length
    ? `You're on the <strong>${escapeHtml(plan.name)}</strong> plan — ${limits.join(' and ')}, no card needed.`
    : `You're on the <strong>${escapeHtml(plan.name)}</strong> plan.`;

  const footerNote = "You're getting this because you just created an Audit Bench Ai account.";
  const html = layout({
    preheader: 'Your account is ready — here are three steps to your first AI code review.',
    heading: 'Welcome to Audit Bench Ai',
    bodyHtml:
      paragraph(name ? `Hi ${escapeHtml(name)},` : 'Hi there,') +
      paragraph(`Thanks for signing up. Audit Bench reviews your code for bugs, security issues and risky changes before they ship. ${planLine}`) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;">${stepRows}</table>` +
      button('Run your first audit', `${appOrigin}/app`) +
      `<p style="margin:16px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};">Questions or feedback? Just reply to this email — it goes straight to our team.</p>`,
    footerNote,
  });

  const text =
    `${name ? `Hi ${name},` : 'Hi there,'}\n\n` +
    `Thanks for signing up. Audit Bench reviews your code for bugs, security issues and risky changes before they ship. ${planLine.replace(/<\/?strong>/g, '')}\n\n` +
    steps.map(([title, body, path], i) => `${i + 1}. ${title}: ${body}\n   ${appOrigin}${path}`).join('\n') +
    `\n\nRun your first audit: ${appOrigin}/app\n\nQuestions or feedback? Just reply to this email.` +
    textFooter(footerNote);

  return { subject: 'Welcome to Audit Bench Ai — your account is ready', html, text };
}
