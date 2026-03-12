export type CallGraphNodeType = 'source' | 'function' | 'sinkCall';

export type CallGraphNode = {
  id: string;
  type: CallGraphNodeType;
  filePath: string; // workspace-relative path
  line: number; // 1-based
  code: string; // trimmed line text
  name?: string;
  description?: string;
};

export type CallGraphEdgeKind = 'calls' | 'containsSink';

export type CallGraphEdge = {
  from: string;
  to: string;
  kind: CallGraphEdgeKind;
};

export type CallGraph = {
  meta: {
    runId: string;
    generatedAt: string;
    counts: {
      nodes: number;
      edges: number;
      sources: number;
      sinkCalls: number;
      functions: number;
    };
  };
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
};

export type CallGraphPath = {
  pathId: string;
  nodeIds: string[];
  sourceId: string;
  sinkCallId: string;
};
