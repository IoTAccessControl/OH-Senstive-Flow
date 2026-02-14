export type PageEntryInfo = {
  filePath: string; // workspace-relative
  structName?: string;
  line?: number; // 1-based
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
  filePath: string; // workspace-relative
  line: number; // 1-based
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

