import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { BenchmarkModelService } from './benchmark-model.service';
import { InvestigatorService } from './investigator.service';
import { CreateBenchmarkModelDto } from './dto/create-benchmark-model.dto';
import { RunInvestigationDto } from './dto/run-investigation.dto';

/**
 * Alignment Lab — a second product line alongside code review, gated per
 * plan (see QuotaService.assertCanRunInvestigation), not by role. Any
 * authenticated user can register a model or browse what their account/org
 * already has; actually running an investigation is where the plan
 * entitlement and monthly quota are enforced. admin/super_admin always pass
 * the gate, for support/testing.
 */
@Controller('alignment-lab')
@UseGuards(JwtAuthGuard)
export class AlignmentLabController {
  constructor(
    private readonly models: BenchmarkModelService,
    private readonly investigator: InvestigatorService,
  ) {}

  @Post('models')
  createModel(@CurrentUser() user: RequestUser, @Body() dto: CreateBenchmarkModelDto) {
    return this.models.create(user, dto);
  }

  @Get('models')
  listModels(@CurrentUser() user: RequestUser) {
    return this.models.findAll(user);
  }

  @Get('models/:id')
  getModel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.models.findOne(user, id);
  }

  @Post('models/:id/investigate')
  investigate(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: RunInvestigationDto) {
    return this.investigator.runInvestigation(user, id, dto.provider);
  }

  @Get('models/:id/investigations')
  listInvestigations(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.investigator.listForModel(user, id);
  }

  @Get('investigations/:id')
  getInvestigation(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.investigator.findOne(user, id);
  }
}
