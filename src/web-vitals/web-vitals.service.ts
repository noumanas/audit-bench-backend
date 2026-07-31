import { Injectable } from '@nestjs/common';
import { WebVitalRating } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecordWebVitalDto } from './dto/record-web-vital.dto';

export interface MetricSummary {
  name: string;
  count: number;
  /** 75th percentile — the actual threshold Core Web Vitals is scored against, not a plain average. */
  p75: number;
  goodPct: number;
  needsImprovementPct: number;
  poorPct: number;
}

function toRatingEnum(rating: string): WebVitalRating {
  return rating.replace('-', '_') as WebVitalRating;
}

/** Nearest-rank percentile over a pre-sorted ascending array. */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}

@Injectable()
export class WebVitalsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(dto: RecordWebVitalDto): Promise<void> {
    await this.prisma.webVital.create({
      data: {
        metricId: dto.id,
        name: dto.name,
        value: dto.value,
        rating: toRatingEnum(dto.rating),
        path: dto.path,
      },
    });
  }

  /** p75 + good/needs-improvement/poor split per metric, over the trailing `days`. */
  async getSummary(days = 7): Promise<MetricSummary[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.webVital.findMany({
      where: { createdAt: { gte: since } },
      select: { name: true, value: true, rating: true },
    });

    const byMetric = new Map<string, { value: number; rating: WebVitalRating }[]>();
    for (const row of rows) {
      const list = byMetric.get(row.name) ?? [];
      list.push(row);
      byMetric.set(row.name, list);
    }

    return Array.from(byMetric.entries())
      .map(([name, entries]) => {
        const values = entries.map((e) => e.value).sort((a, b) => a - b);
        const count = entries.length;
        const countOf = (r: WebVitalRating) => entries.filter((e) => e.rating === r).length;
        return {
          name,
          count,
          p75: percentile(values, 75),
          goodPct: Math.round((countOf('good') / count) * 100),
          needsImprovementPct: Math.round((countOf('needs_improvement') / count) * 100),
          poorPct: Math.round((countOf('poor') / count) * 100),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
