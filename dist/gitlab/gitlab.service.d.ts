import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GitlabMrDetails, GitlabProjectSummary } from './gitlab.types';
export declare class GitlabService {
    private readonly prisma;
    private readonly config;
    constructor(prisma: PrismaService, config: ConfigService);
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
}
