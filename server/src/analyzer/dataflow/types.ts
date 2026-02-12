export type DataflowNode = {
  id: string;
  filePath: string; // workspace-relative
  line: number; // 1-based
  code: string;
  description: string;
  context: {
    startLine: number; // 1-based
    lines: string[];
  };
};

export type DataflowEdge = {
  from: string;
  to: string;
};

export type DataflowSummary = {
  dataItems?: string[];
  collectionFrequency?: string[];
  cloudUpload?: string[];
  storageAndEncryption?: string[];
  permissions?: string[];
};

export type Dataflow = {
  flowId: string;
  pathId: string;
  nodes: DataflowNode[];
  edges: DataflowEdge[];
  summary?: DataflowSummary;
};

export type DataflowsResult = {
  meta: {
    runId: string;
    generatedAt: string;
    skipped?: boolean;
    skipReason?: string;
    llm?: {
      provider: string;
      model: string;
    };
    counts: {
      flows: number;
      nodes: number;
      edges: number;
    };
  };
  flows: Dataflow[];
};

