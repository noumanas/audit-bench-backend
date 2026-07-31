import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // FRONTEND_ORIGIN accepts a comma-separated list, so both a deployed
  // frontend and localhost can be allowed at once during development.
  const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      }
    },
    // navigator.sendBeacon() always sends credentials (cookies) on a
    // cross-origin request — no way to opt out — so the browser requires
    // this on the response whenever a credentialed request is involved, not
    // just for beacons specifically. Safe alongside a strict origin
    // allowlist (never '*') above; only the '*' + credentials combination is
    // the unsafe one.
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Only used to read the short-lived OAuth CSRF-state cookie (see OAuthController) — no sessions.
  app.use(cookieParser());
  // navigator.sendBeacon() (see WebVitalsReporter) can only send
  // CORS-safelisted "simple" requests cross-origin — application/json isn't
  // safelisted, so the beacon deliberately sends as text/plain instead to
  // avoid a doomed preflight. The bytes are still valid JSON, so this route
  // specifically parses a text/plain body the same way; every other route
  // keeps the stricter application/json-only parser below.
  app.use('/web-vitals', json({ type: ['application/json', 'text/plain'] }));
  app.use(
    json({
      limit: '5mb', // large pasted files
      // Webhook signature verification (GitHub HMAC) needs the exact raw
      // bytes GitHub signed — re-serializing the parsed JSON wouldn't
      // reliably match byte-for-byte, so stash it alongside the parsed body.
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
