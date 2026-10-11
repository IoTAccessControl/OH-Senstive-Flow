import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repairPrivacyReportClassification } from '../analyzer/privacy/reportLinks.js';
import { resolveRunIdToOutputDir } from './run.js';

const runId = process.argv[2];
if (!runId) throw new Error('用法：npm -w server run repair:privacy-classification -- <runId>');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outputDirAbs = await resolveRunIdToOutputDir(repoRoot, runId);
const result = await repairPrivacyReportClassification({ repoRoot, outputDirAbs });
console.log(`${runId}：${result.assigned} 个链接已关联真实页面/功能，${result.fallback} 个保留应用级证据分类。`);
