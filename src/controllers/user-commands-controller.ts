////////////////////////////////////////////////////////////////////////////////////
// MIT License
//
// Copyright (c) 2021-2024 NVIDIA Corporation
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
////////////////////////////////////////////////////////////////////////////////////
import { BazelTargetManager } from '../models/bazel-target-manager';
import { WorkspaceStateManager } from '../models/workspace-state-manager';
import { BazelService } from '../services/bazel-service';
import { ConfigurationManager, ShellCommand } from '../services/configuration-manager';
import { Console } from '../services/console';
import { ShellService } from '../services/shell-service';
import { TaskService } from '../services/task-service';
import { showProgress } from '../ui/progress';
import { QuickPickItemWithTreeNode, RootNode, TreeNode } from './tree-picker';
import * as vscode from 'vscode';


/**
 * Controller class for executing user custom commands.
 */

type PickStateRecord = Record<string, boolean>;

type PickStateMap = Record<string, PickStateRecord>;

export class UserCommandsController {

    private static CONFIG_KEYWORDS = {
        executable: 'bluebazel.executable',
        runTarget: 'bluebazel.runTarget',
        buildTarget: 'bluebazel.buildTarget',
        testTarget: 'bluebazel.testTarget',
        runArgs: 'bluebazel.runArgs',
        testArgs: 'bluebazel.testArgs',
        buildConfigs: 'bluebazel.buildConfigs',
        runConfigs: 'bluebazel.runConfigs',
        testConfigs: 'bluebazel.testConfigs',
        bazelBuildArgs: 'bluebazel.bazelBuildArgs',
        bazelRunArgs: 'bluebazel.bazelRunArgs',
        bazelTestArgs: 'bluebazel.bazelTestArgs',
        buildEnvVars: 'bluebazel.buildEnvVars',
        runEnvVars: 'bluebazel.runEnvVars',
        testEnvVars: 'bluebazel.testEnvVars',
        formatCommand: 'bluebazel.formatCommand'
    };

    private static EXTENSION_COMMANDS = {
        treepick: 'TreePick',
        multipick: 'MultiPick',
        pick: 'Pick',
        input: 'Input'
    };

    constructor(
        private readonly configurationManager: ConfigurationManager,
        private readonly shellService: ShellService, // Inject the services
        private readonly taskService: TaskService,
        private readonly bazelTargetManager: BazelTargetManager,
        private readonly workspaceStateManager: WorkspaceStateManager
    ) {
    }

    private static PICK_STATE_KEY: string = "userCommandsController.pickStateMap";

    public async runCustomTask(command: string): Promise<void> {
        const pickStateMap: PickStateMap = this.workspaceStateManager.get(UserCommandsController.PICK_STATE_KEY, {});
        const resolver = new this.Resolver(this.bazelTargetManager, this.configurationManager, this.shellService, pickStateMap);
        let completeCommand = resolver.resolveKeywords(command);
        return showProgress(`Running ${completeCommand}`, async (cancellationToken) => {
            try {
                completeCommand = await resolver.resolveExtensionCommands(completeCommand);
                completeCommand = await resolver.resolveCommands(completeCommand);
                this.taskService.runTask(completeCommand, completeCommand, this.configurationManager.isClearTerminalBeforeAction(), cancellationToken);
            } catch (error) {
                vscode.window.showErrorMessage(`Error running custom task: ${error}`);
            } finally {
                this.workspaceStateManager.update(UserCommandsController.PICK_STATE_KEY, pickStateMap);
            }
        });
    }

    private static formatTestArgs(testArgs: string): string {
        const value = testArgs;
        const pattern = /(--\S+)/g;
        const result = value.replace(pattern, '--test_arg $1');
        return result;
    }

    private Resolver = class {
        public cache: Map<string, string> = new Map<string, string>();

        constructor(
            private bazelTargetManager: BazelTargetManager,
            private configurationManager: ConfigurationManager,
            private shellService: ShellService,
            private pickStateMap: PickStateMap
        ) { }

        protected resolveKeyword(keyword: string): string {
            const buildTarget = this.bazelTargetManager.getSelectedTarget('build');
            const runTarget = this.bazelTargetManager.getSelectedTarget('run');
            const testTarget = this.bazelTargetManager.getSelectedTarget('test');

            const keywordMap: Map<string, () => string> = new Map([
                [UserCommandsController.CONFIG_KEYWORDS.runArgs, () => runTarget.getRunArgs().toString()],
                [UserCommandsController.CONFIG_KEYWORDS.testArgs, () => UserCommandsController.formatTestArgs(testTarget.getRunArgs().toString())],
                [UserCommandsController.CONFIG_KEYWORDS.runTarget, () => {
                    return BazelService.formatBazelTargetFromPath(runTarget.buildPath);
                }],
                [UserCommandsController.CONFIG_KEYWORDS.testTarget, () => testTarget.buildPath],
                [UserCommandsController.CONFIG_KEYWORDS.buildConfigs, () => buildTarget.getConfigArgs().toString()],
                [UserCommandsController.CONFIG_KEYWORDS.runConfigs, () => runTarget.getConfigArgs().toString()],
                [UserCommandsController.CONFIG_KEYWORDS.testConfigs, () => testTarget.getConfigArgs().toString()],
                [UserCommandsController.CONFIG_KEYWORDS.bazelBuildArgs, () => buildTarget.getBazelArgs().toString()],
                [UserCommandsController.CONFIG_KEYWORDS.bazelRunArgs, () => runTarget.getBazelArgs().toString()],
                [UserCommandsController.CONFIG_KEYWORDS.bazelTestArgs, () => testTarget.getBazelArgs().toString()],
                [UserCommandsController.CONFIG_KEYWORDS.buildEnvVars, () => buildTarget.getEnvVars().toStringArray().join(' ')],
                [UserCommandsController.CONFIG_KEYWORDS.runEnvVars, () => runTarget.getEnvVars().toStringArray().join(' ')],
                [UserCommandsController.CONFIG_KEYWORDS.testEnvVars, () => buildTarget.getEnvVars().toStringArray().join(' ')],
                [UserCommandsController.CONFIG_KEYWORDS.buildTarget, () => testTarget.buildPath],
                [UserCommandsController.CONFIG_KEYWORDS.executable, () => this.configurationManager.getExecutableCommand()],
                [UserCommandsController.CONFIG_KEYWORDS.formatCommand, () => this.configurationManager.getFormatCommand()],
            ]);

            const getValue = keywordMap.get(keyword);
            return getValue ? getValue() : `\${${keyword}}`;
        }

        private async buildPickList(input: string, picker: (label: string) => boolean): Promise<vscode.QuickPickItem[]> {
            // Evaluate the inner command of the pick
            const output = await this.resolveCommands(input);
            // Make a list of the output
            const outputList = [];
            for (const element of output.split('\n')) {
                const label = element.trim();
                if (label.length > 0) {
                    outputList.push({ 'label': label, 'picked': picker(label) });
                }
            }
            return outputList;
        }

        private async extPick(input: vscode.QuickPickItem[]): Promise<string> {
            try {
                return vscode.window.showQuickPick(
                    input,
                    { 'ignoreFocusOut': true }
                ).then((data) => {
                    return data !== undefined ? data.label : ''
                });
            } catch (error) {
                return Promise.reject(error);
            }
        }

        private async buildTestCaseTree(input: string) : Promise<RootNode> {
            // Evaluate the inner command of the pick
            const output = await this.resolveCommands(input);

            // specific to pytest format
            const transformedLabels = output.split('\n').map((label: string) => {
                return label.replace(/\.py(::[^:\/]+)$/, ".py/$1");
            });

            const rootNode = new RootNode();
            for (const label of transformedLabels) {
                rootNode.createPathToTestCase(label);
            }
            return Promise.resolve(rootNode);
        }

        private flattenTestCaseTree(rootNode: RootNode, picker: (node: TreeNode) => boolean): QuickPickItemWithTreeNode[] {
            // Make a list of the output
            const outputList: QuickPickItemWithTreeNode[] = [];

            try {
                rootNode.dfs((node: TreeNode): boolean => {
                    if (node.isTest) {
                        outputList.push({ 'label': node.getPath(), 'picked': picker(node), 'node': node });
                    } else if (node.isTestCase) {
                        outputList.push({ 'label': `\u2937${node.value}`, 'picked': picker(node), 'node': node });
                    }
                    return true;
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Error flattening tree: ${error}`);
            }

            return outputList;
        }

        private async extPickTree(rootNode: RootNode, picker: (node: TreeNode) => boolean): Promise<Set<string>> {
            try {
                return new Promise<Set<string>>((resolve, reject) => {
                    const input: QuickPickItemWithTreeNode[] = this.flattenTestCaseTree(rootNode, picker);
                    const quickPick = vscode.window.createQuickPick<QuickPickItemWithTreeNode>();
                    quickPick.canSelectMany = true;
                    quickPick.title = "Select Test Cases";
                    quickPick.ignoreFocusOut = true;
                    quickPick.items = input;
                    quickPick.selectedItems = input.filter(item => item.picked);

                    let previousSelections: Set<string> = new Set<string>(input.filter(item => item.picked).map(item => item.node.getPath()));

                    quickPick.onDidChangeSelection((selectedItems: readonly QuickPickItemWithTreeNode[]) => {
                        const selectedPaths = new Set<string>(selectedItems.map(item => item.node.getPath()));

                        const unchecked = new Set<string>([...previousSelections].filter((item) => !selectedPaths.has(item)));
                        const checked = new Set<string>([...selectedPaths].filter((item) => !previousSelections.has(item)));

                        quickPick.items.forEach((item) => {
                            const node = item.node;
                            if (checked.has(node.getPath())) {
                                item.picked = true;
                            } else if (unchecked.has(node.getPath())) {
                                item.picked = false;
                            }
                            let ptr = node.parent;
                            while (ptr !== null) {
                                if (checked.has(ptr.getPath())) {
                                    item.picked = true;
                                } else if (unchecked.has(ptr.getPath())) {
                                    item.picked = false;
                                }  
                                ptr = ptr.parent;
                            }
                        });

                        previousSelections.clear();
                        quickPick.items.filter(item => item.picked).forEach((item) => previousSelections.add(item.node.getPath()));
                        quickPick.selectedItems = quickPick.items.filter(item => item.picked);
                    });
                    quickPick.onDidAccept(() => {
                        resolve(new Set<string>([...quickPick.selectedItems].map(item => item.node.getPath())));
                        quickPick.hide();
                    });

                    quickPick.show();
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Error picking tree: ${error}`);
                return Promise.reject(error);
            }
        }

        private async extPickMany(input: vscode.QuickPickItem[]): Promise<string[]> {
            try {
                return vscode.window.showQuickPick(
                    input,
                    { 'ignoreFocusOut': true, 'canPickMany': true }
                ).then((data) => {
                    return data !== undefined ? data : []
                }).then((data) => {
                    return data.map((item) => item.label);
               });
            } catch (error) {
                return Promise.reject(error);
            }
        }

        private async extInput(input: string): Promise<string> {
            try {
                let resolvedInput = await this.resolveCommands(input);
                if (resolvedInput !== undefined) {
                    // we take the first result if this is a multi-line string
                    resolvedInput = resolvedInput.split('\n')[0];
                }
                return vscode.window.showInputBox(
                    { value: resolvedInput }
                ).then((val) => {
                    return val !== undefined ? val : ''
                });
            } catch (error) {
                return Promise.reject(error);
            }
        }

        public async resolveExtensionCommands(input: string): Promise<string> {
            // Execute commands
            let output = input;
            const regexp = /\[([^\s]*)\(([^\s]*)\)\]/g;
            let match;
            try {
                do {
                    match = regexp.exec(input);
                    if (match) {
                        const extCommand = match[1];
                        const extArgs = match[2];
                        let evalRes = '';
                        if (extCommand === UserCommandsController.EXTENSION_COMMANDS.treepick) {
                            let state = this.pickStateMap[output] ?? {};
                            const rootNode: RootNode = await this.buildTestCaseTree(extArgs);
                            const paths: Set<string> = await this.extPickTree(rootNode, (node: TreeNode) => state[node.getPath()] ?? false);
                            evalRes = [...paths].join("\n");
                            state = {};
                            paths.forEach((path) => state[path] = true);
                            this.pickStateMap[output] = state;
                        } else if (extCommand === UserCommandsController.EXTENSION_COMMANDS.multipick) {
                            let state = this.pickStateMap[output] ?? {};
                            const input = await this.buildPickList(extArgs, (label) => state[label] ?? false);
                            const labels = await this.extPickMany(input);
                            evalRes = labels.join("\n");
                            state = {};
                            labels.forEach((label) => state[label] = true);
                            this.pickStateMap[output] = state;
                        } else if (extCommand === UserCommandsController.EXTENSION_COMMANDS.pick) {
                            const input = await this.buildPickList(extArgs, (label) => false);
                            evalRes = await this.extPick(input);
                        } else if (extCommand === UserCommandsController.EXTENSION_COMMANDS.input) {
                            evalRes = await this.extInput(extArgs);
                        }
                        output = output.replace(match[0], evalRes);
                    }
                } while (match);
            } catch (error) {
                return Promise.reject(error);
            }
            return output;
        }

        public resolveKeywords(input: string): string {
            let output = input;
            // First replace keywords
            const regexp = /\$\{([^\s]*)\}/g;
            let match;
            do {
                match = regexp.exec(input);
                if (match) {
                    output = output.replace(match[0], this.resolveKeyword(match[1]));
                }
            } while (match);
            return output;
        }

        private findCommandByKeyword(keyword: string): ShellCommand | undefined {
            const commands = this.configurationManager.getShellCommands();
            return commands.find((item) => item.name == keyword);
        }

        public async resolveCommands(input: string): Promise<string> {
            // Execute commands
            let output = input;
            const regexp = /<([^\s]*)>/g;
            let match;
            do {
                match = regexp.exec(input);
                if (match) {
                    try {
                        const cmd = this.findCommandByKeyword(match[1]);
                        let evalRes = '';
                        if (cmd !== undefined) {
                            if (cmd.memoized && this.cache.has(cmd.name)) {
                                evalRes = this.cache.get(cmd.name) ?? '';
                            } else {
                                const resolvedCmd = await this.resolveCommand(cmd.command);
                                const cmdRes = await this.shellService.runShellCommand(resolvedCmd);
                                evalRes = cmdRes.stdout;
                                this.cache.set(cmd.name, evalRes);
                            }
                        }

                        output = output.replace(match[0], evalRes);
                    } catch (error) {
                        return Promise.reject(error);
                    }
                }
            } while (match);
            return output;
        }

        private async resolveCommand(command: string): Promise<string> {
            try {
                let res = this.resolveKeywords(command);
                res = await this.resolveExtensionCommands(res);
                res = await this.resolveCommands(res);
                return res;
            } catch (error) {
                return Promise.reject(error);
            }
        }
    }
}
