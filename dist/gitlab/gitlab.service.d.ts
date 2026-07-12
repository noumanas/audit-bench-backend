import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GitlabMrDetails, GitlabProjectSummary } from './gitlab.types';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback, PrPublisher } from '../pr-feedback/pr-feedback.types';
import { TokenCryptoService } from '../common/token-crypto.service';
export declare class GitlabService implements OnModuleInit, PrPublisher {
    private readonly prisma;
    private readonly config;
    private readonly prFeedback;
    private readonly tokenCrypto;
    constructor(prisma: PrismaService, config: ConfigService, prFeedback: PrFeedbackService, tokenCrypto: TokenCryptoService);
    onModuleInit(): void;
    private baseUrl;
    private authHeaders;
    private requireToken;
    private refreshAccessToken;
    connect(userId: string, token: string): Promise<{
        username: string;
    }>;
    disconnect(userId: string): Promise<void>;
    status(userId: string): Promise<{
        connected: boolean;
        username: string | null;
    }>;
    listProjects(userId: string): Promise<GitlabProjectSummary[]>;
    listBranches(userId: string, projectId: number): Promise<string[]>;
    downloadProjectZip(userId: string, projectId: number, ref?: string): Promise<Buffer>;
    fetchMrFiles(userId: string, projectId: number, mrIid: number): Promise<GitlabMrDetails>;
    private fetchFileContent;
    getProjectMeta(userId: string, projectId: number): Promise<{
        defaultBranch: string;
    }>;
    getFileAtRef(userId: string, projectId: number, path: string, ref: string): Promise<string>;
    commitFile(userId: string, projectId: number, branch: string, path: string, content: string, message: string, startBranch?: string): Promise<string>;
    createMergeRequest(userId: string, projectId: number, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<{
        url: string;
        iid: number;
    }>;
    publish(userId: string, context: Extract<PrContext, {
        kind: 'gitlab';
    }>, feedback: PrFeedback): Promise<void>;
    private postMrDiscussions;
    postMrNote(userId: string, projectId: number, mrIid: number, body: string): Promise<void>;
    private postMrNoteWithToken;
    private postCommitStatus;
    static verifyWebhookToken(secret: string, tokenHeader: string | undefined): boolean;
}
