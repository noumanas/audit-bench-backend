/**
 * Brand values for what the backend draws outside the app: the PR summary's
 * header badge, the README score badge and emails. Same artwork and colours
 * as the website (front-end Logo.tsx / globals.css).
 */
export const BRAND_PURPLE = '7546f4';

/** The Audit Bench Ai symbol in white, for dark badge labels. */
export const BRAND_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 121.05 111.94"><path fill="#fff" d="M96.8,63.44l-66.8-.09v-5.41h32.84V24.25C62.84,10.86,51.98,0,38.59,0h0C25.2,0,14.34,10.86,14.34,24.25v18.03H0v15.66h14.2v5.4H0v15.66h14.2v32.84h15.66l67.96.09c13.39,0,23.22-10.86,23.22-24.25h0c0-13.39-10.86-24.25-24.25-24.25ZM30,23.99c0-4.61,3.73-8.34,8.34-8.34h.5c4.61,0,8.34,3.73,8.34,8.34v18.29h-17.19v-18.29ZM105.39,87.94c0,4.61-3.73,8.34-8.34,8.34l-67.19-.09v-17.19l67.19.09c4.61,0,8.34,3.73,8.34,8.34v.5Z"/></svg>';

/** shields.io takes a custom logo as a base64 data URI. */
export const BRAND_MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(BRAND_MARK_SVG).toString('base64')}`;

/**
 * Black "audit bench" lockup on white, 256x100 (shown at 128x50). Served by the
 * website from public/brand/; emails need an absolute, publicly reachable URL.
 */
export const EMAIL_LOGO_URL = 'https://auditbenchai.com/brand/email-lockup.png';

export const BRAND_TAGLINE = 'Build fast. Check what ships.';
