export type DataflowNodeRef = {
  flowId: string;
  nodeId: string;
};

export type UiNodeRef = {
  uiNodeId: string;
};

export type PrivacyDataItem = {
  name: string;
  refs: DataflowNodeRef[];
};

export type PrivacyRecipient = {
  name: string;
  inferred?: boolean;
  refs?: DataflowNodeRef[];
};

export type PrivacyToggleUi = {
  where: string;
  refs?: UiNodeRef[];
};

export type PrivacyDataPractice = {
  appName: string;
  businessScenario: string;
  dataSources: string[];
  dataItems: PrivacyDataItem[];
  processingMethod: string;
  storageMethod: string;
  dataRecipients: PrivacyRecipient[];
  processingPurpose: string;
  privacyToggleUi?: PrivacyToggleUi;
};

export type PrivacyPermissionPractice = {
  permissionName: string;
  businessScenario: string;
  permissionPurpose: string;
  denyImpact: string;
  refs: DataflowNodeRef[];
};

export type ModulePrivacyFactsContent = {
  dataPractices: PrivacyDataPractice[];
  permissionPractices: PrivacyPermissionPractice[];
};

export type ModulePrivacyFactsFile = {
  meta: {
    runId: string;
    moduleId: string;
    generatedAt: string;
    llm?: { provider: string; model: string };
    skipped?: boolean;
    skipReason?: string;
    warnings?: string[];
  };
  facts: ModulePrivacyFactsContent;
};

export type PrivacyReportJumpTo = {
  moduleId: string;
  flowId: string;
  nodeId: string;
};

export type PrivacyReportToken = {
  text: string;
  jumpTo?: PrivacyReportJumpTo;
};

export type PrivacyReportSection = {
  moduleId: string;
  tokens: PrivacyReportToken[];
};

export type PrivacyReportFile = {
  meta: {
    runId: string;
    generatedAt: string;
    llm?: { provider: string; model: string };
    skipped?: boolean;
    skipReason?: string;
    counts: { modules: number };
  };
  sections: {
    collectionAndUse: PrivacyReportSection[];
    permissions: PrivacyReportSection[];
  };
};

