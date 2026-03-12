export type PageEntryInfo = {
  filePath: string;
  structName?: string;
  line?: number;
  description?: string;
};

export type PageInfo = {
  pageId: string;
  entry: PageEntryInfo;
  counts: {
    features: number;
    flows: number;
  };
};

export type PagesIndex = {
  meta: {
    runId: string;
    generatedAt: string;
    counts: {
      pages: number;
      features: number;
      flows: number;
      unassignedFlows: number;
    };
  };
  pages: PageInfo[];
};

export type FeatureKind = 'ui' | 'source';

export type FeatureAnchor = {
  filePath: string;
  line: number;
  uiNodeId?: string;
  functionName?: string;
};

export type FeatureInfo = {
  featureId: string;
  title: string;
  kind: FeatureKind;
  anchor: FeatureAnchor;
  counts: {
    flows: number;
    nodes: number;
    edges: number;
  };
};

export type PageFeaturesIndex = {
  meta: {
    runId: string;
    generatedAt: string;
    pageId: string;
    counts: {
      features: number;
      flows: number;
    };
  };
  page: {
    pageId: string;
    entry: PageEntryInfo;
  };
  features: FeatureInfo[];
};

export type UiTreeNodeCategory = 'Page' | 'Button' | 'Input' | 'Display' | 'Component';

export type UiTreeNavTarget = {
  kind: 'pushUrl' | 'replaceUrl' | 'back';
  url?: string;
  resolvedFilePath?: string;
};

export type UiTreeNode = {
  id: string;
  category: UiTreeNodeCategory;
  description: string;
  name?: string;
  filePath?: string;
  line?: number;
  code?: string;
  context?: {
    startLine: number;
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
