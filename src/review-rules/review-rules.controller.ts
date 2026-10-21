import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { ReviewRulesService } from './review-rules.service';
import { CreateReviewRuleDto, UpdateReviewRuleDto } from './dto/review-rule.dto';

@Controller('review-rules')
@UseGuards(JwtAuthGuard)
export class ReviewRulesController {
  constructor(private readonly rules: ReviewRulesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.rules.list(user);
  }

  /** Accepted / dismissed / ignored findings on closed PRs, last 90 days. */
  @Get('outcomes')
  outcomes(@CurrentUser() user: RequestUser) {
    return this.rules.outcomes(user);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateReviewRuleDto) {
    return this.rules.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateReviewRuleDto) {
    return this.rules.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.rules.remove(user, id);
  }
}
