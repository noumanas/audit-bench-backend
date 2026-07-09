import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { GithubService } from './github.service';
import { RepositoryService } from '../repository/repository.service';
import { ConnectGithubDto } from './dto/connect-github.dto';
import { ScanRepoDto } from './dto/scan-repo.dto';
import { ReviewPrDto } from './dto/review-pr.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';

@Controller('github')
@UseGuards(JwtAuthGuard)
export class GithubController {
  constructor(
    private readonly githubService: GithubService,
    private readonly repositoryService: RepositoryService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: RequestUser) {
    return this.githubService.status(user.id);
  }

  @Post('connect')
  connect(@CurrentUser() user: RequestUser, @Body() dto: ConnectGithubDto) {
    return this.githubService.connect(user.id, dto.token);
  }

  @Delete('disconnect')
  disconnect(@CurrentUser() user: RequestUser) {
    return this.githubService.disconnect(user.id);
  }

  @Get('repos')
  listRepos(@CurrentUser() user: RequestUser) {
    return this.githubService.listRepos(user.id);
  }

  @Post('scan')
  async scan(@CurrentUser() user: RequestUser, @Body() dto: ScanRepoDto) {
    const zipBuffer = await this.githubService.downloadRepoZip(user.id, dto.owner, dto.repo, dto.ref);
    return this.repositoryService.createScanJobFromBuffer(
      user.id,
      zipBuffer,
      `${dto.owner}/${dto.repo}`,
      dto.provider,
      'github_repo',
    );
  }

  @Post('pr')
  async reviewPr(@CurrentUser() user: RequestUser, @Body() dto: ReviewPrDto) {
    const { files, url } = await this.githubService.fetchPrFiles(user.id, dto.owner, dto.repo, dto.pullNumber);
    return this.repositoryService.createDiffReview(user.id, files, {
      sourceName: `${dto.owner}/${dto.repo}#${dto.pullNumber}`,
      sourceType: 'github_pr',
      pullRequestUrl: url,
      provider: dto.provider,
    });
  }
}
