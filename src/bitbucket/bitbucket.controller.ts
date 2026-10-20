import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { RepositoryService } from '../repository/repository.service';
import { extractZip } from '../analysis/file-walker';
import { BitbucketService } from './bitbucket.service';
import { ConnectBitbucketDto, ReviewBitbucketPrDto, ScanBitbucketRepoDto } from './dto/bitbucket.dto';

@Controller('bitbucket')
@UseGuards(JwtAuthGuard)
export class BitbucketController {
  constructor(
    private readonly bitbucket: BitbucketService,
    private readonly repositoryService: RepositoryService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: RequestUser) {
    return this.bitbucket.status(user.id);
  }

  @Post('connect')
  connect(@CurrentUser() user: RequestUser, @Body() dto: ConnectBitbucketDto) {
    return this.bitbucket.connect(user.id, dto.token);
  }

  @Delete('disconnect')
  disconnect(@CurrentUser() user: RequestUser) {
    return this.bitbucket.disconnect(user.id);
  }

  @Get('repos')
  listRepos(@CurrentUser() user: RequestUser) {
    return this.bitbucket.listRepos(user.id);
  }

  @Get('repos/:workspace/:slug/branches')
  listBranches(@CurrentUser() user: RequestUser, @Param('workspace') workspace: string, @Param('slug') slug: string) {
    return this.bitbucket.listBranches(user.id, workspace, slug);
  }

  @Get('repos/:workspace/:slug/pulls')
  listPulls(@CurrentUser() user: RequestUser, @Param('workspace') workspace: string, @Param('slug') slug: string) {
    return this.bitbucket.listPullRequests(user.id, workspace, slug);
  }

  @Post('scan')
  async scan(@CurrentUser() user: RequestUser, @Body() dto: ScanBitbucketRepoDto) {
    const { defaultBranch } = await this.bitbucket.getRepoMeta(user.id, dto.workspace, dto.repoSlug);
    const ref = dto.ref || defaultBranch;
    const zip = await this.bitbucket.downloadRepoZip(user.id, dto.workspace, dto.repoSlug, ref);
    return this.repositoryService.createScanJobFromBuffer(
      user,
      zip,
      `${dto.workspace}/${dto.repoSlug}`,
      dto.provider,
      'bitbucket_repo',
      { kind: 'bitbucket', workspace: dto.workspace, repoSlug: dto.repoSlug, ref, defaultBranch },
    );
  }

  /** Reviews the PR's changed lines and posts inline comments, a summary and a build status back to Bitbucket. */
  @Post('pr')
  async reviewPr(@CurrentUser() user: RequestUser, @Body() dto: ReviewBitbucketPrDto) {
    const pr = await this.bitbucket.fetchPrFiles(user.id, dto.workspace, dto.repoSlug, dto.pullId);
    // Related-code context is a bonus: a failed download just means a review without it.
    const repoFiles = await this.bitbucket
      .downloadRepoZip(user.id, dto.workspace, dto.repoSlug, pr.headSha)
      .then((zip) => extractZip(zip, 200_000))
      .catch(() => undefined);
    return this.repositoryService.createDiffReview(
      user,
      pr.files,
      {
        sourceName: `${dto.workspace}/${dto.repoSlug}#${dto.pullId}`,
        sourceType: 'bitbucket_pr',
        pullRequestUrl: pr.url,
        provider: dto.provider,
        prContext: {
          kind: 'bitbucket',
          workspace: dto.workspace,
          repoSlug: dto.repoSlug,
          pullId: dto.pullId,
          headSha: pr.headSha,
          sourceBranch: pr.sourceBranch,
          destinationBranch: pr.destinationBranch,
        },
      },
      { repoFiles },
    );
  }
}
