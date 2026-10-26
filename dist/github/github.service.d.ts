import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GithubPrDetails, GithubPrSummary, GithubRepoSummary } from './github.types';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback, PrPublisher } from '../pr-feedback/pr-feedback.types';
import { TokenCryptoService } from '../common/token-crypto.service';
import { GithubAppAuthService, GithubAuth } from './github-app-auth.service';
export type { GithubAuth };
import { ContributorStat } from '../analysis/types';
import { buildSummaryBody } from '../pr-feedback/summary-comment';
export declare class GithubService implements OnModuleInit, PrPublisher {
    private readonly prisma;
    private readonly prFeedback;
    private readonly tokenCrypto;
    private readonly appAuth;
    private readonly logger;
    constructor(prisma: PrismaService, prFeedback: PrFeedbackService, tokenCrypto: TokenCryptoService, appAuth: GithubAppAuthService);
    onModuleInit(): void;
    private authHeaders;
    private requireToken;
    connect(userId: string, token: string): Promise<{
        username: string;
    }>;
    disconnect(userId: string): Promise<void>;
    status(userId: string): Promise<{
        connected: boolean;
        username: string | null;
        via: "token" | "app" | null;
        appAccounts: string[];
    }>;
    private linkedInstallations;
    authFor(userId: string, owner: string): Promise<GithubAuth>;
    listReposFor(userId: string): Promise<GithubRepoSummary[]>;
    private listInstallationRepos;
    listRepos(auth: GithubAuth): Promise<GithubRepoSummary[]>;
    listBranches(auth: GithubAuth, owner: string, repo: string): Promise<string[]>;
    listPullRequests(auth: GithubAuth, owner: string, repo: string): Promise<GithubPrSummary[]>;
    downloadRepoZip(auth: GithubAuth, owner: string, repo: string, ref?: string): Promise<Buffer>;
    fetchContributorStats(auth: GithubAuth, owner: string, repo: string): Promise<ContributorStat[]>;
    private requestContributorStats;
    fetchPrFiles(auth: GithubAuth, owner: string, repo: string, pullNumber: number, opts?: {
        withSnapshot?: boolean;
        withRepoContext?: boolean;
    }): Promise<GithubPrDetails>;
    private repoFilesForContext;
    getRepoMeta(auth: GithubAuth, owner: string, repo: string): Promise<{
        defaultBranch: string;
    }>;
    getFileAtRef(auth: GithubAuth, owner: string, repo: string, path: string, ref: string): Promise<{
        content: string;
        sha: string;
    }>;
    getBranchHeadSha(auth: GithubAuth, owner: string, repo: string, branch: string): Promise<string>;
    createBranch(auth: GithubAuth, owner: string, repo: string, newBranch: string, fromSha: string): Promise<void>;
    commitFileUpdate(auth: GithubAuth, owner: string, repo: string, path: string, branch: string, content: string, message: string, sha: string): Promise<string>;
    createPullRequest(auth: GithubAuth, owner: string, repo: string, title: string, head: string, base: string, body: string): Promise<{
        url: string;
        number: number;
    }>;
    private fetchFileContent;
    publish(userId: string, context: Extract<PrContext, {
        kind: 'github';
    }>, feedback: PrFeedback): Promise<void>;
    private postCheckRun;
    startReviewStatus(auth: GithubAuth, owner: string, repo: string, sha: string): Promise<number | undefined>;
    fail(userId: string, context: Extract<PrContext, {
        kind: 'github';
    }>, reason: string): Promise<void>;
    stopReviewStatus(auth: GithubAuth, owner: string, repo: string, sha: string, reason: string, checkRunId?: number): Promise<void>;
    postReviewWithToken(token: string, owner: string, repo: string, pullNumber: number, headSha: string, feedback: PrFeedback): Promise<void>;
    private postPrReview;
    private postCommitStatus;
    private postStatuses;
    canPushTo(userId: string, owner: string, repo: string): Promise<boolean>;
    createReviewComment(auth: GithubAuth, owner: string, repo: string, pullNumber: number, opts: {
        commitId: string;
        path: string;
        start: number;
        end: number;
        body: string;
    }): Promise<{
        id: number;
        htmlUrl: string;
    }>;
    getReviewComment(auth: GithubAuth, owner: string, repo: string, commentId: number): Promise<GithubReviewComment>;
    listPullReviewComments(auth: GithubAuth, owner: string, repo: string, pullNumber: number): Promise<GithubReviewComment[]>;
    reviewThreadStates(auth: GithubAuth, owner: string, repo: string, pullNumber: number): Promise<Map<number, {
        resolved: boolean;
        outdated: boolean;
    }>>;
    listReviewThread(auth: GithubAuth, owner: string, repo: string, pullNumber: number, rootId: number): Promise<GithubReviewComment[]>;
    replyToReviewComment(auth: GithubAuth, owner: string, repo: string, pullNumber: number, rootId: number, body: string): Promise<void>;
    resolveReviewThread(auth: GithubAuth, owner: string, repo: string, pullNumber: number, rootId: number): Promise<boolean>;
    postIssueComment(auth: GithubAuth, owner: string, repo: string, issueNumber: number, body: string): Promise<void>;
    static verifyWebhookSignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean;
}
export declare function mapGithubContributorStats(raw: unknown[]): ContributorStat[];
export declare function explainPostFailure(status: number, message: string): string;
export interface GithubReviewComment {
    id: number;
    in_reply_to_id?: number;
    body: string;
    path: string;
    line: number | null;
    start_line: number | null;
    original_line: number | null;
    original_start_line: number | null;
    created_at: string;
    user: {
        login: string;
    } | null;
    reactions?: {
        '+1'?: number;
        '-1'?: number;
    };
}
export { buildSummaryBody };
