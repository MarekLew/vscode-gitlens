'use strict';
import { InputBoxOptions, Uri, window } from 'vscode';
import { GitService } from '../gitService';
import { CommandContext } from '../commands';
import { Command, Commands } from './common';
import { Logger } from '../logger';
import { CommandQuickPickItem, RepositoriesQuickPick } from '../quickPicks';
import { GlyphChars } from '../constants';

export interface StashSaveCommandArgs {
    message?: string;
    uris?: Uri[];

    goBackCommand?: CommandQuickPickItem;
}

export class StashSaveCommand extends Command {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.StashSave);
    }

    protected async preExecute(context: CommandContext, args: StashSaveCommandArgs = {}): Promise<any> {
        if (context.type === 'scm-states') {
            args = { ...args };
            args.uris = context.scmResourceStates.map(s => s.resourceUri);
            return this.execute(args);
        }

        if (context.type === 'scm-groups') {
            args = { ...args };
            args.uris = context.scmResourceGroups.reduce<Uri[]>((a, b) => a.concat(b.resourceStates.map(s => s.resourceUri)), []);
            return this.execute(args);
        }

        return this.execute(args);
    }

    async execute(args: StashSaveCommandArgs = {}) {
        let repoPath = await this.git.getHighlanderRepoPath();
        if (!repoPath) {
            const pick = await RepositoriesQuickPick.show(this.git, `Stash changes for which repository${GlyphChars.Ellipsis}`, args.goBackCommand);
            if (pick instanceof CommandQuickPickItem) return pick.execute();
            if (pick === undefined) return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();

            repoPath = pick.repoPath;
        }

        try {
            if (args.message == null) {
                args = { ...args };
                args.message = await window.showInputBox({
                    prompt: `Please provide a stash message`,
                    placeHolder: `Stash message`
                } as InputBoxOptions);
                if (args.message === undefined) return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
            }

            return await this.git.stashSave(repoPath, args.message, args.uris);
        }
        catch (ex) {
            Logger.error(ex, 'StashSaveCommand');
            return window.showErrorMessage(`Unable to save stash. See output channel for more details`);
        }
    }
}