
/*
const transformedLabels = labels.map((label: string) => {
    return label.replace(/\.py(::[^:\/]+)$/, ".py/$1");
});

const rootNode = new TreeNode("/", "", null);

// add nodes to tree

for (const label of transformedLabels) {

    let node = rootNode;

    let path = "";
    for (const part of label.split("/")) {
        let child;
        path += part;
        if (!node.hasChild(part)) {
            child = node.addChild(path, part);
        } else {
            child = node.getChild(part);
        }
o        path += "/";
        node = child;
    }
    node.setTestCase();
}

rootNode.dfs((child: TreeNode) => {
    if (child.isTestCase) {
        console.log(`[ ]  \u2937${child.value}`);
        return false;
    } else {
        if (child.isTest) {
            console.log(`[ ] ${child.path}`);
        }
        return true;
    }
});
*/

import { QuickPickItem } from 'vscode';

export interface QuickPickItemWithTreeNode extends QuickPickItem {
    node: TreeNode
}

export class TreeNode {
    value: string;
    isTestCase: boolean;
    children: Map<string, TreeNode>;
    edges: string[];
    parent: TreeNode|null;
    isTest: boolean;
    item?: QuickPickItemWithTreeNode;

    constructor(value: string, parent: TreeNode|null) {
        this.value = value;
        this.children = new Map<string, TreeNode>();
        this.edges = [];
        this.isTestCase = false;
        this.parent = parent;
        this.isTest = false;
    }

    public getPath() : string {
        return this.parent!.getPath() + this.value + ((this.isTest || this.isTestCase) ? "" : "/");
    }

    public hasChild(edge: string) : boolean {
        return this.children.has(edge);
    }

    public getChild(edge: string) : TreeNode {
        if (!this.hasChild(edge)) {
            throw new Error(`No such edge ${edge} at ${this.getPath()}`);
        }
        const node = this.children.get(edge);
        return node!;
    }

    public getOrAddChild(edge: string) : TreeNode {
        if (this.hasChild(edge)) {
            return this.getChild(edge);
        }

        return this.addChild(edge);
    }

    public createPathToTestCase(path: string) : TreeNode {
        let node: TreeNode = this;
        for (const part of path.split("/")) {
            node = node.getOrAddChild(part);
        }
        node.setTestCase();
        return node;
    }

    public addChild(edge: string) : TreeNode {
        if (this.hasChild(edge)) {
            throw Error(`Duplicate node ${edge} on ${this.getPath()}`);
        }
        const child = new TreeNode(edge, this);
        this.children.set(child.value, child);
        this.edges.push(child.value);
        return child;
    }

    public findDescendentByPath(path: string) : TreeNode|undefined {
        const edges: string[] = path.split("/");
        let node: TreeNode = this;
        for (const edge of edges) {
            if (!node.hasChild(edge)) {
                return;
            }
            node = node.getChild(edge);
        }
        return node;
    }

    public setTestCase() : TreeNode {
        this.isTestCase = true;
        if (this.parent !== null) {
            this.parent.isTest = true;
        }
        return this;
    }

    public setItem(item: QuickPickItemWithTreeNode) {
        this.item = item;
        return this;
    }

    public isRootNote() : boolean {
        return false;
    }

    public findRoot(visitor: (node: TreeNode) => void) {
        let ptr = this.parent;
        while (ptr !== null) {
            visitor(ptr);
            ptr = ptr.parent;
        }
    }

    public dfs(visitor: (node: TreeNode) => boolean) {
        TreeNode._dfs(this, visitor);
    }

    static _dfs(node: TreeNode, visitor: (node: TreeNode) => boolean) {
        for (const edge of node.edges.sort()) {
            const child = node.getChild(edge);
            if (visitor(child)) {
                TreeNode._dfs(child, visitor);
            }
        }
    }
}

export class RootNode extends TreeNode {
    constructor() {
        super("", null);
    }

    public isRootNode() : boolean {
        return true;
    }

    public getPath() : string {
        return "";
    }
}
