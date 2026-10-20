import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GithubPrDetails, GithubPrSummary, GithubRepoSummary } from './github.types';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback, PrPublisher } from '../pr-feedback/pr-feedback.types';
import { TokenCryptoService } from '../common/token-crypto.service';
import { ContributorStat } from '../analysis/types';
import { buildSummaryBody } from '../pr-feedback/summary-comment';
export declare class GithubService implements OnModuleInit, PrPublisher {
    private readonly prisma;
    private readonly prFeedback;
    private readonly tokenCrypto;
    constructor(prisma: PrismaService, prFeedback: PrFeedbackService, tokenCrypto: TokenCryptoService);
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
    }>;
    listRepos(userId: string): Promise<GithubRepoSummary[]>;
    listBranches(userId: string, owner: string, repo: string): Promise<string[]>;
    listPullRequests(userId: string, owner: string, repo: string): Promise<GithubPrSummary[]>;
    downloadRepoZip(userId: string, owner: string, repo: string, ref?: string): Promise<Buffer>;
    fetchContributorStats(userId: string, owner: string, repo: string): Promise<ContributorStat[]>;
    private requestContributorStats;
    fetchPrFiles(userId: string, owner: string, repo: string, pullNumber: number, opts?: {
        withSnapshot?: boolean;
    }): Promise<GithubPrDetails>;
    getRepoMeta(userId: string, owner: string, repo: string): Promise<{
        defaultBranch: string;
    }>;
    getFileAtRef(userId: string, owner: string, repo: string, path: string, ref: string): Promise<{
        content: string;
        sha: string;
    }>;
    getBranchHeadSha(userId: string, owner: string, repo: string, branch: string): Promise<string>;
    createBranch(userId: string, owner: string, repo: string, newBranch: string, fromSha: string): Promise<void>;
    commitFileUpdate(userId: string, owner: string, repo: string, path: string, branch: string, content: string, message: string, sha: string): Promise<string>;
    createPullRequest(userId: string, owner: string, repo: string, title: string, head: string, base: string, body: string): Promise<{
        url: string;
        number: number;
    }>;
    private fetchFileContent;
    publish(userId: string, context: Extract<PrContext, {
        kind: 'github';
    }>, feedback: PrFeedback): Promise<void>;
    postReviewWithToken(token: string, owner: string, repo: string, pullNumber: number, headSha: string, feedback: PrFeedback): Promise<void>;
    private postPrReview;
    private postCommitStatus;
    canPushTo(userId: string, owner: string, repo: string): Promise<boolean>;
    getReviewComment(userId: string, owner: string, repo: string, commentId: number): Promise<GithubReviewComment>;
    listReviewThread(userId: string, owner: string, repo: string, pullNumber: number, rootId: number): Promise<GithubReviewComment[]>;
    replyToReviewComment(userId: string, owner: string, repo: string, pullNumber: number, rootId: number, body: string): Promise<void>;
    resolveReviewThread(userId: string, owner: string, repo: string, pullNumber: number, rootId: number): Promise<boolean>;
    postIssueComment(userId: string, owner: string, repo: string, issueNumber: number, body: string): Promise<void>;
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
}
export { buildSummaryBody };
