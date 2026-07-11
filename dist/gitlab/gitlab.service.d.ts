import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GitlabMrDetails, GitlabProjectSummary } from './gitlab.types';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback, PrPublisher } from '../pr-feedback/pr-feedback.types';
export declare class GitlabService implements OnModuleInit, PrPublisher {
    private readonly prisma;
    private readonly config;
    private readonly prFeedback;
    constructor(prisma: PrismaService, config: ConfigService, prFeedback: PrFeedbackService);
    onModuleInit(): void;
    private baseUrl;
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
    listProjects(userId: string): Promise<GitlabProjectSummary[]>;
    listBranches(userId: string, projectId: number): Promise<string[]>;
    downloadProjectZip(userId: string, projectId: number, ref?: string): Promise<Buffer>;
    fetchMrFiles(userId: string, projectId: number, mrIid: number): Promise<GitlabMrDetails>;
    private fetchFileContent;
    publish(userId: string, context: Extract<PrContext, {
        kind: 'gitlab';
    }>, feedback: PrFeedback): Promise<void>;
    private postMrDiscussions;
    postMrNote(userId: string, projectId: number, mrIid: number, body: string): Promise<void>;
    private postMrNoteWithToken;
    private postCommitStatus;
    static verifyWebhookToken(secret: string, tokenHeader: string | undefined): boolean;
}
