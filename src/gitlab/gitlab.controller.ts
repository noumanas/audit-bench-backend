import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { GitlabService } from './gitlab.service';
import { RepositoryService } from '../repository/repository.service';
import { ConnectGitlabDto } from './dto/connect-gitlab.dto';
import { ScanProjectDto } from './dto/scan-project.dto';
import { ReviewMrDto } from './dto/review-mr.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';

@Controller('gitlab')
@UseGuards(JwtAuthGuard)
export class GitlabController {
  constructor(
    private readonly gitlabService: GitlabService,
    private readonly repositoryService: RepositoryService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: RequestUser) {
    return this.gitlabService.status(user.id);
  }

  @Post('connect')
  connect(@CurrentUser() user: RequestUser, @Body() dto: ConnectGitlabDto) {
    return this.gitlabService.connect(user.id, dto.token);
  }

  @Delete('disconnect')
  disconnect(@CurrentUser() user: RequestUser) {
    return this.gitlabService.disconnect(user.id);
  }

  @Get('projects')
  listProjects(@CurrentUser() user: RequestUser) {
    return this.gitlabService.listProjects(user.id);
  }

  @Get('projects/:projectId/branches')
  listBranches(@CurrentUser() user: RequestUser, @Param('projectId', ParseIntPipe) projectId: number) {
    return this.gitlabService.listBranches(user.id, projectId);
  }

  @Post('scan')
  async scan(@CurrentUser() user: RequestUser, @Body() dto: ScanProjectDto) {
    const zipBuffer = await this.gitlabService.downloadProjectZip(user.id, dto.projectId, dto.ref);
    return this.repositoryService.createScanJobFromBuffer(
      user.id,
      zipBuffer,
      dto.projectPath || `project ${dto.projectId}`,
      dto.provider,
      'gitlab_repo',
    );
  }

  @Post('mr')
  async reviewMr(@CurrentUser() user: RequestUser, @Body() dto: ReviewMrDto) {
    const { files, url } = await this.gitlabService.fetchMrFiles(user.id, dto.projectId, dto.mrIid);
    return this.repositoryService.createDiffReview(user.id, files, {
      sourceName: `${dto.projectPath || `project ${dto.projectId}`} !${dto.mrIid}`,
      sourceType: 'gitlab_mr',
      pullRequestUrl: url,
      provider: dto.provider,
    });
  }
}
