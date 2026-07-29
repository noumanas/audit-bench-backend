import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { BenchmarkModelService } from './benchmark-model.service';
import { InvestigatorService } from './investigator.service';
import { CreateBenchmarkModelDto } from './dto/create-benchmark-model.dto';
import { RunInvestigationDto } from './dto/run-investigation.dto';

/**
 * Alignment-lab pilot — admin-only research feature, deliberately separate
 * from the code-review product's audit/repository endpoints. See
 * BenchmarkModel/Investigation in schema.prisma for the "why admin-only,
 * why a real LLM call instead of a fine-tuned model" reasoning.
 */
@Controller('alignment-lab')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class AlignmentLabController {
  constructor(
    private readonly models: BenchmarkModelService,
    private readonly investigator: InvestigatorService,
  ) {}

  @Post('models')
  createModel(@CurrentUser() user: RequestUser, @Body() dto: CreateBenchmarkModelDto) {
    return this.models.create(user.id, dto);
  }

  @Get('models')
  listModels(@CurrentUser() user: RequestUser) {
    return this.models.findAll(user.id);
  }

  @Get('models/:id')
  getModel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.models.findOne(user.id, id);
  }

  @Post('models/:id/investigate')
  investigate(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: RunInvestigationDto) {
    return this.investigator.runInvestigation(user.id, id, dto.provider);
  }

  @Get('models/:id/investigations')
  listInvestigations(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.investigator.listForModel(user.id, id);
  }

  @Get('investigations/:id')
  getInvestigation(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.investigator.findOne(user.id, id);
  }
}
