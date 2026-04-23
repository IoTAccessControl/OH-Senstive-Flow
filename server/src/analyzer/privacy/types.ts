export type DataflowNodeRef = {
  flowId: string;
  nodeId: string;
};

export type PrivacyDataItem = {
  name: string;
  refs: DataflowNodeRef[];
};

export type PrivacyRecipient = {
  name: string;
  refs?: DataflowNodeRef[];
};

export type PrivacyDataPractice = {
  businessScenario: string;
  dataSources: string[];
  dataItems: PrivacyDataItem[];
  processingMethod: string;
  storageMethod: string;
  dataRecipients: PrivacyRecipient[];
  processingPurpose: string;
};

export type PrivacyPermissionPractice = {
  permissionName: string;
  authorizationMode?: 'preauthorized' | 'dynamic';
  businessScenario: string;
  permissionPurpose: string;
  denyImpact: string;
  refs: DataflowNodeRef[];
};

export type FeaturePrivacyFactsContent = {
  dataPractices: PrivacyDataPractice[];
  permissionPractices: PrivacyPermissionPractice[];
};

export type PrivacyReportJumpTo = {
  featureId: string;
  flowId: string;
  nodeId: string;
};

export type PrivacyReportToken = {
  text: string;
  jumpTo?: PrivacyReportJumpTo;
};

export type PrivacyReportSection = {
  featureId: string;
  tokens: PrivacyReportToken[];
};

export type PrivacyReportFile = {
  meta: {
    runId: string;
    generatedAt: string;
    llm?: { provider: string; model: string };
    skipped?: boolean;
    skipReason?: string;
    warnings?: string[];
    counts: { features: number };
  };
  sections: {
    collectionAndUse: PrivacyReportSection[];
    permissions: PrivacyReportSection[];
  };
};
