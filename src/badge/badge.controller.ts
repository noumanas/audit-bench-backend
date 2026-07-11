import { Controller, Get, Param, Query } from '@nestjs/common';
import { BadgeService } from './badge.service';

// Public — no JwtAuthGuard. Anyone with the (unguessable) badgeToken can
// fetch the verdict, same trust model as any README badge (e.g. shields.io
// itself, CI status badges). Never exposes findings, code, or the user's
// identity, only a pass/needs-work/failing label.
@Controller('badge')
export class BadgeController {
  constructor(private readonly badgeService: BadgeService) {}

  @Get(':badgeToken/verdict')
  getVerdict(@Param('badgeToken') badgeToken: string, @Query('repo') repo?: string) {
    return this.badgeService.getVerdictBadge(badgeToken, repo);
  }
}
