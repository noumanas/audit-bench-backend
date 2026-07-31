import { IsIn, IsNumber, IsString, MaxLength, MinLength } from 'class-validator';

// Core Web Vitals as reported by the `web-vitals` library Next.js bundles
// (see next/web-vitals) — FID kept alongside its replacement, INP, since
// older browsers without INP support still report FID.
const METRIC_NAMES = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];
const RATINGS = ['good', 'needs-improvement', 'poor'];

export class RecordWebVitalDto {
  @IsString()
  @MaxLength(64)
  id: string;

  @IsString()
  @IsIn(METRIC_NAMES)
  name: string;

  @IsNumber()
  value: number;

  @IsString()
  @IsIn(RATINGS)
  rating: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  path: string;
}
