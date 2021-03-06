'use strict';
import { Strings } from '../system';
import { Uri } from 'vscode';
import { DocumentSchemes, GlyphChars } from '../constants';
import { GitCommit, GitService, IGitStatusFile } from '../gitService';
import * as path from 'path';

export interface IGitCommitInfo {
    fileName?: string;
    repoPath: string;
    sha?: string;
}

interface UriEx {
    new(): Uri;
    new(scheme: string, authority: string, path: string, query: string, fragment: string): Uri;
}

export class GitUri extends ((Uri as any) as UriEx) {

    repoPath?: string | undefined;
    sha?: string | undefined;

    constructor(uri?: Uri)
    constructor(uri: Uri, commit: IGitCommitInfo);
    constructor(uri: Uri, repoPath: string | undefined);
    constructor(uri?: Uri, commitOrRepoPath?: IGitCommitInfo | string) {
        if (uri === undefined) {
            super();

            return;
        }

        if (uri.scheme === DocumentSchemes.GitLensGit) {
            const data: IUriRevisionData = JSON.parse(uri.query);
            super(uri.scheme, uri.authority, path.resolve(data.repoPath, data.fileName), uri.query, uri.fragment);

            this.repoPath = data.repoPath;
            if (GitService.isStagedUncommitted(data.sha) || !GitService.isUncommitted(data.sha)) {
                this.sha = data.sha;
            }

            return;
        }

        if (commitOrRepoPath === undefined) {
            super(uri.scheme, uri.authority, uri.path, uri.query, uri.fragment);

            return;
        }

        if (typeof commitOrRepoPath === 'string') {
            super(uri.scheme, uri.authority, uri.path, uri.query, uri.fragment);

            this.repoPath = commitOrRepoPath;

            return;
        }

        super(uri.scheme, uri.authority, path.resolve(commitOrRepoPath.repoPath, commitOrRepoPath.fileName || uri.fsPath), uri.query, uri.fragment);

        this.repoPath = commitOrRepoPath.repoPath;
        if (GitService.isStagedUncommitted(commitOrRepoPath.sha) || !GitService.isUncommitted(commitOrRepoPath.sha)) {
            this.sha = commitOrRepoPath.sha;
        }
    }

    get shortSha() {
        return this.sha && GitService.shortenSha(this.sha);
    }

    fileUri(useSha: boolean = true) {
        return Uri.file(useSha && this.sha ? this.path : this.fsPath);
    }

    getFormattedPath(separator: string = Strings.pad(GlyphChars.Dot, 2, 2), relativeTo?: string): string {
        let directory = path.dirname(this.fsPath);
        if (this.repoPath) {
            directory = path.relative(this.repoPath, directory);
        }
        if (relativeTo !== undefined) {
            directory = path.relative(relativeTo, directory);
        }
        directory = GitService.normalizePath(directory);

        return (!directory || directory === '.')
            ? path.basename(this.fsPath)
            : `${path.basename(this.fsPath)}${separator}${directory}`;
    }

    getRelativePath(relativeTo?: string): string {
        let relativePath = path.relative(this.repoPath || '', this.fsPath);
        if (relativeTo !== undefined) {
            relativePath = path.relative(relativeTo, relativePath);
        }
        return GitService.normalizePath(relativePath);
    }

    static fromCommit(commit: GitCommit, previous: boolean = false) {
        if (!previous) return new GitUri(commit.uri, commit);

        return new GitUri(commit.previousUri, {
            repoPath: commit.repoPath,
            sha: commit.previousSha
        });
    }

    static fromFileStatus(status: IGitStatusFile, repoPath: string, sha?: string, original: boolean = false): GitUri {
        const uri = Uri.file(path.resolve(repoPath, (original && status.originalFileName) || status.fileName));
        return sha === undefined
            ? new GitUri(uri, repoPath)
            : new GitUri(uri, { repoPath: repoPath, sha: sha });
    }

    static fromRepoPath(repoPath: string, ref?: string) {
        return ref === undefined
            ? new GitUri(Uri.file(repoPath), repoPath)
            : new GitUri(Uri.file(repoPath), { repoPath: repoPath, sha: ref });
    }

    static fromRevisionUri(uri: Uri): GitUri {
        return new GitUri(uri);
    }

    static async fromUri(uri: Uri, git: GitService) {
        if (uri instanceof GitUri) return uri;

        if (!git.isTrackable(uri)) return new GitUri(uri);

        if (uri.scheme === DocumentSchemes.GitLensGit) return new GitUri(uri);

        // If this is a git uri, find its repoPath
        if (uri.scheme === DocumentSchemes.Git) {
            const data: { path: string, ref: string } = JSON.parse(uri.query);

            const repoPath = await git.getRepoPath(data.path);

            return new GitUri(uri, {
                fileName: data.path,
                repoPath: repoPath,
                sha: data.ref === '' || data.ref == null
                    ? undefined
                    : data.ref
            } as IGitCommitInfo);
        }

        const gitUri = git.getGitUriForVersionedFile(uri);
        if (gitUri) return gitUri;

        return new GitUri(uri, await git.getRepoPath(uri));
    }

    static getDirectory(fileName: string, relativeTo?: string): string {
        let directory: string | undefined = path.dirname(fileName);
        if (relativeTo !== undefined) {
            directory = path.relative(relativeTo, directory);
        }
        directory = GitService.normalizePath(directory);
        return (!directory || directory === '.') ? '' : directory;
    }

    static getFormattedPath(fileNameOrUri: string | Uri, separator: string = Strings.pad(GlyphChars.Dot, 2, 2), relativeTo?: string): string {
        let fileName: string;
        if (fileNameOrUri instanceof Uri) {
            if (fileNameOrUri instanceof GitUri) return fileNameOrUri.getFormattedPath(separator, relativeTo);

            fileName = fileNameOrUri.fsPath;
        }
        else {
            fileName = fileNameOrUri;
        }

        const directory = GitUri.getDirectory(fileName, relativeTo);
        return !directory
            ? path.basename(fileName)
            : `${path.basename(fileName)}${separator}${directory}`;
    }

    static getRelativePath(fileNameOrUri: string | Uri, relativeTo?: string, repoPath?: string): string {
        let fileName: string;
        if (fileNameOrUri instanceof Uri) {
            if (fileNameOrUri instanceof GitUri) return fileNameOrUri.getRelativePath(relativeTo);

            fileName = fileNameOrUri.fsPath;
        }
        else {
            fileName = fileNameOrUri;
        }

        let relativePath = path.relative(repoPath || '', fileName);
        if (relativeTo !== undefined) {
            relativePath = path.relative(relativeTo, relativePath);
        }
        return GitService.normalizePath(relativePath);
    }

    static toRevisionUri(uri: GitUri): Uri;
    static toRevisionUri(sha: string, fileName: string, repoPath: string): Uri;
    static toRevisionUri(sha: string, status: IGitStatusFile, repoPath: string): Uri;
    static toRevisionUri(uriOrSha: string | GitUri, fileNameOrStatus?: string | IGitStatusFile, repoPath?: string): Uri {
        let fileName: string;
        let sha: string | undefined;
        let shortSha: string | undefined;

        if (typeof uriOrSha === 'string') {
            if (typeof fileNameOrStatus === 'string') {
                fileName = fileNameOrStatus;
            }
            else {
                fileName = path.resolve(repoPath!, fileNameOrStatus!.fileName);
            }

            sha = uriOrSha;
            shortSha = GitService.shortenSha(sha);
        }
        else {
            fileName = uriOrSha.fsPath!;
            repoPath = uriOrSha.repoPath!;
            sha = uriOrSha.sha;
            shortSha = uriOrSha.shortSha;
        }

        const data: IUriRevisionData = {
            fileName: GitService.normalizePath(path.relative(repoPath!, fileName)),
            repoPath: repoPath!,
            sha: sha
        };

        const parsed = path.parse(fileName);
        return Uri.parse(`${DocumentSchemes.GitLensGit}:${path.join(parsed.dir, parsed.name)}:${shortSha}${parsed.ext}?${JSON.stringify(data)}`);
    }

}

interface IUriRevisionData {
    sha?: string;
    fileName: string;
    repoPath: string;
}
