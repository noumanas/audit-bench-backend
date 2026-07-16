import { LineRange } from '../common/diff-ranges';
export interface GitlabProjectSummary {
    id: number;
    pathWithNamespace: string;
    name: string;
    private: boolean;
    description: string | null;
    defaultBranch: string;
    updatedAt: string;
    webUrl: string;
}
export interface GitlabMrSummary {
    iid: number;
    title: string;
    sourceBranch: string;
    targetBranch: string;
    draft: boolean;
    updatedAt: string;
    webUrl: string;
}
export interface GitlabMrFile {
    path: string;
    content: string;
    changedRanges: LineRange[];
    status: 'added' | 'modified' | 'renamed';
}
export interface GitlabMrDetails {
    files: GitlabMrFile[];
    headSha: string;
    url: string;
    diffRefs: {
        baseSha: string;
        startSha: string;
        headSha: string;
    };
    sourceBranch: string;
    targetBranch: string;
}
