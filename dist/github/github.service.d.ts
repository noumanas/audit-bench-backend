import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GithubPrDetails, GithubRepoSummary } from './github.types';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback, PrPublisher } from '../pr-feedback/pr-feedback.types';
import { TokenCryptoService } from '../common/token-crypto.service';
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
    downloadRepoZip(userId: string, owner: string, repo: string, ref?: string): Promise<Buffer>;
    fetchPrFiles(userId: string, owner: string, repo: string, pullNumber: number): Promise<GithubPrDetails>;
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
    private postPrReview;
    private postCommitStatus;
    postIssueComment(userId: string, owner: string, repo: string, issueNumber: number, body: string): Promise<void>;
    static verifyWebhookSignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean;
}
