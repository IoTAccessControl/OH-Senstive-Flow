export type UiTreeNodeCategory = 'Page' | 'Button' | 'Input' | 'Display' | 'Component';

export type UiTreeNavTarget = {
  kind: 'pushUrl' | 'replaceUrl' | 'back';
  url?: string;
  resolvedFilePath?: string; // workspace-relative
};

export type UiTreeNode = {
  id: string;
  category: UiTreeNodeCategory;
  description: string;

  name?: string; // struct name or component name
  filePath?: string; // workspace-relative
  line?: number; // 1-based
  code?: string;
  context?: {
    startLine: number; // 1-based
    lines: string[];
  };

  navTarget?: UiTreeNavTarget;
};

export type UiTreeEdge = {
  from: string;
  to: string;
  kind: 'contains' | 'navigatesTo';
};

export type UiTreeResult = {
  meta: {
    runId: string;
    generatedAt: string;
    skipped?: boolean;
    skipReason?: string;
    llm?: { provider: string; model: string };
    counts: {
      nodes: number;
      edges: number;
      pages: number;
      elements: number;
    };
  };
  roots: string[];
  nodes: Record<string, UiTreeNode>;
  edges: UiTreeEdge[];
};

