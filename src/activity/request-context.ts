import { isIPv4 } from 'net';
import type { Request } from 'express';
import ip3country = require('ip3country');

/** Who made a request and roughly from where — attached to ActivityLog rows. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

export const EMPTY_CONTEXT: RequestContext = { ip: null, userAgent: null, countryCode: null, region: null, city: null };

// Codes edges send for "unknown" / Tor / anonymizers rather than a real country.
const NON_COUNTRIES = new Set(['XX', 'ZZ', 'T1', 'A1', 'A2', 'O1', 'EU', 'AP']);

let ip3Ready = false;

/** ip3country builds its lookup table on init — do it once, lazily. */
function countryFromIp(ip: string): string | null {
  // Its behaviour is unspecified for anything but dotted IPv4, so IPv6 gets no country from it.
  if (!isIPv4(ip)) return null;
  if (!ip3Ready) {
    ip3country.init();
    ip3Ready = true;
  }
  return ip3country.lookupStr(ip);
}

function header(req: Request, name: string): string | null {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  try {
    // Vercel URI-encodes city names ("S%C3%A3o%20Paulo").
    return decodeURIComponent(first).trim().slice(0, 100) || null;
  } catch {
    return first.trim().slice(0, 100) || null;
  }
}

function cleanCountry(code: string | null): string | null {
  const upper = code?.toUpperCase() ?? null;
  return upper && /^[A-Z]{2}$/.test(upper) && !NON_COUNTRIES.has(upper) ? upper : null;
}

/**
 * Reads the client IP (req.ip — accurate only with TRUST_PROXY set behind a
 * proxy, see main.ts), user agent and an approximate location. Country comes
 * from the IP via ip3country's bundled table, so no IP leaves the server.
 * Region/city are only known when an edge in front of the API adds them
 * (Cloudflare, Vercel, App Engine) — and since a client could forge those
 * headers when there is no such edge, they're read only with
 * TRUST_GEO_HEADERS=true.
 */
export function requestContext(req: Request, trustGeoHeaders: boolean): RequestContext {
  const rawIp = req.ip ?? req.socket?.remoteAddress ?? null;
  const ip = rawIp?.replace(/^::ffff:/, '') || null;
  const userAgent = (req.headers['user-agent'] ?? '').slice(0, 400) || null;

  let countryCode: string | null = null;
  let region: string | null = null;
  let city: string | null = null;
  if (trustGeoHeaders) {
    countryCode = cleanCountry(
      header(req, 'cf-ipcountry') ?? header(req, 'x-vercel-ip-country') ?? header(req, 'x-appengine-country'),
    );
    region = header(req, 'cf-region') ?? header(req, 'x-vercel-ip-country-region') ?? header(req, 'x-appengine-region');
    city = header(req, 'cf-ipcity') ?? header(req, 'x-vercel-ip-city') ?? header(req, 'x-appengine-city');
  }
  if (!countryCode && ip) countryCode = cleanCountry(countryFromIp(ip));

  return { ip, userAgent, countryCode, region, city };
}
