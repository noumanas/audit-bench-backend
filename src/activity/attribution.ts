import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * First-touch attribution the frontend captured before the visitor signed up
 * (see AttributionCapture) — sent once, with the signup or the OAuth exchange.
 * All of it is client-supplied, so it's length-capped and only ever displayed.
 */
export class AttributionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  landingPath?: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * "Where did this user come from": utm_source when the link was tagged, else
 * the referring site's host, else "direct". Our own hosts count as direct —
 * that's navigation inside the site, not an acquisition channel.
 */
export function signupSource(attribution: AttributionDto | undefined, ownOrigins: string[]): string {
  const utm = attribution?.utmSource?.trim().toLowerCase();
  if (utm) return utm.slice(0, 100);
  const host = attribution?.referrer ? hostOf(attribution.referrer) : null;
  const ownHosts = new Set(ownOrigins.map(hostOf).filter(Boolean));
  if (host && !ownHosts.has(host)) return host;
  return 'direct';
}
