import { PrismaService } from '../prisma/prisma.service';
import { GithubPrDetails, GithubRepoSummary } from './github.types';
export declare class GithubService {
    private readonly prisma;
    constructor(prisma: PrismaService);
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
    downloadRepoZip(userId: string, owner: string, repo: string, ref?: string): Promise<Buffer>;
    fetchPrFiles(userId: string, owner: string, repo: string, pullNumber: number): Promise<GithubPrDetails>;
    private fetchFileContent;
}
