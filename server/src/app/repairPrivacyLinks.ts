import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { repairPrivacyReportEvidence } from '../analyzer/privacy/report.js';
import { resolveRunIdToOutputDir } from './run.js';

const runId = process.argv[2];
if (!runId) throw new Error('用法：npm -w server run repair:privacy-links -- <runId>');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outputDirAbs = await resolveRunIdToOutputDir(repoRoot, runId);
const result = await repairPrivacyReportEvidence({ repoRoot, outputDirAbs });
console.log(`已修复 ${runId} 的隐私报告链接：${result.meta.counts.flows} 条路径，${result.meta.counts.nodes} 个节点，${result.meta.counts.edges} 条连接。`);
