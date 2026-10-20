import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { GithubService } from './github.service';
import { RepositoryService } from '../repository/repository.service';
import { ConnectGithubDto } from './dto/connect-github.dto';
import { ScanRepoDto } from './dto/scan-repo.dto';
import { ReviewPrDto } from './dto/review-pr.dto';
import { ReviewPrUrlDto } from './dto/review-pr-url.dto';
import { parseGithubPrUrl } from '../common/github-url';
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

  @Get('repos/:owner/:repo/branches')
  listBranches(@CurrentUser() user: RequestUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.githubService.listBranches(user.id, owner, repo);
  }

  @Get('repos/:owner/:repo/pulls')
  listPullRequests(@CurrentUser() user: RequestUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.githubService.listPullRequests(user.id, owner, repo);
  }

  @Post('scan')
  async scan(@CurrentUser() user: RequestUser, @Body() dto: ScanRepoDto) {
    const { defaultBranch } = await this.githubService.getRepoMeta(user.id, dto.owner, dto.repo);
    const ref = dto.ref || defaultBranch;
    const [zipBuffer, contributorStats] = await Promise.all([
      this.githubService.downloadRepoZip(user.id, dto.owner, dto.repo, dto.ref),
      this.githubService.fetchContributorStats(user.id, dto.owner, dto.repo),
    ]);
    return this.repositoryService.createScanJobFromBuffer(
      user,
      zipBuffer,
      `${dto.owner}/${dto.repo}`,
      dto.provider,
      'github_repo',
      { kind: 'github', owner: dto.owner, repo: dto.repo, ref, defaultBranch },
      contributorStats,
    );
  }

  @Post('pr')
  async reviewPr(@CurrentUser() user: RequestUser, @Body() dto: ReviewPrDto) {
    const { files, url, headSha, headRef, baseRef, snapshot, repoFiles } = await this.githubService.fetchPrFiles(
      user.id,
      dto.owner,
      dto.repo,
      dto.pullNumber,
      { withSnapshot: true, withRepoContext: true },
    );
    return this.repositoryService.createDiffReview(
      user,
      files,
      {
        sourceName: `${dto.owner}/${dto.repo}#${dto.pullNumber}`,
        sourceType: 'github_pr',
        pullRequestUrl: url,
        provider: dto.provider,
        prContext: {
          kind: 'github',
          owner: dto.owner,
          repo: dto.repo,
          pullNumber: dto.pullNumber,
          headSha,
          headRef,
          baseRef,
        },
      },
      { prSnapshot: snapshot, repoFiles },
    );
  }

  /**
   * Any pull request by its link — including public repositories the user
   * doesn't own. With postToGithub the review is posted on the PR as the
   * connected account, exactly as if the user had commented themselves;
   * without it the review stays in the app.
   */
  @Post('pr-url')
  async reviewPrByUrl(@CurrentUser() user: RequestUser, @Body() dto: ReviewPrUrlDto) {
    const parsed = parseGithubPrUrl(dto.prUrl);
    if (!parsed) {
      throw new BadRequestException('Paste a GitHub pull request link, like https://github.com/owner/repo/pull/123');
    }
    const { owner, repo, number } = parsed;
    const { files, url, headSha, headRef, baseRef, snapshot, repoFiles } = await this.githubService.fetchPrFiles(
      user.id,
      owner,
      repo,
      number,
      { withSnapshot: true, withRepoContext: true },
    );
    if (dto.postToGithub && snapshot && snapshot.state !== 'open') {
      throw new BadRequestException(
        `${owner}/${repo}#${number} is already ${snapshot.merged ? 'merged' : 'closed'}, so a review comment wouldn't help. Turn off "Post on GitHub" to review it in the app.`,
      );
    }
    return this.repositoryService.createDiffReview(
      user,
      files,
      {
        sourceName: `${owner}/${repo}#${number}`,
        sourceType: 'github_pr',
        pullRequestUrl: url,
        provider: dto.provider,
        // prContext is what makes the finished review post back to GitHub.
        prContext: dto.postToGithub
          ? {
              kind: 'github',
              owner,
              repo,
              pullNumber: number,
              headSha,
              headRef,
              baseRef,
            }
          : undefined,
      },
      { prSnapshot: snapshot, repoFiles },
    );
  }
}
