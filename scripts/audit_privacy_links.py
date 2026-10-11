#!/usr/bin/env python3
"""Check the exact feature/flow/node destinations used by privacy report links."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ERROR_STATUSES = {'missing_report', 'ambiguous_feature', 'broken_flow', 'broken_node', 'invalid_edges', 'disconnected', 'generated_source', 'missing_source', 'invalid_source_line', 'unrelated_source'}

def read(path, default=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default

def audit_run(root):
    report = read(root / 'privacy_report.json')
    if not report:
        return {'status': 'missing_report', 'links': [], 'counts': {}}
    features = {}
    for page in read(root / 'pages/index.json', {}).get('pages', []):
        for feature in read(root / 'pages' / page['pageId'] / 'features/index.json', {}).get('features', []):
            features.setdefault(feature['featureId'], []).append(page['pageId'])
    links = []
    cache = {}
    source_cache = {}
    app_path = read(root / 'meta.json', {}).get('input', {}).get('appPath')
    app_root = (ROOT / app_path).resolve() if app_path else ROOT.resolve()
    for paragraphs in report.get('sections', {}).values():
        for paragraph in paragraphs:
            for token in paragraph.get('tokens', []):
                jump = token.get('jumpTo')
                if not jump:
                    continue
                pages = features.get(jump['featureId'], [])
                if jump.get('pageId'):
                    pages = [page for page in pages if page == jump['pageId']]
                key = (pages[0] if pages else None, jump['featureId'])
                if key not in cache:
                    file = root / 'pages' / key[0] / 'features' / key[1] / 'dataflows.json' if pages else root / 'dataflows.json'
                    cache[key] = read(file, {})
                flow = next((item for item in cache[key].get('flows', []) if item['flowId'] == jump['flowId']), None)
                result = {'text': token['text'], 'jumpTo': jump, 'pageId': key[0], 'status': 'connected', 'nodes': 0, 'edges': 0}
                if len(pages) > 1:
                    result['status'] = 'ambiguous_feature'
                elif not flow:
                    result['status'] = 'broken_flow'
                else:
                    nodes, edges = flow['nodes'], flow['edges']
                    by_id = {node['id']: node for node in nodes}
                    adjacency = {node_id: set() for node_id in by_id}
                    invalid = False
                    for edge in edges:
                        if edge['from'] not in by_id or edge['to'] not in by_id:
                            invalid = True
                            continue
                        adjacency[edge['from']].add(edge['to'])
                        adjacency[edge['to']].add(edge['from'])
                    target = by_id.get(jump['nodeId'])
                    seen, queue = set(), [jump['nodeId']] if target else []
                    while queue:
                        item = queue.pop()
                        if item in seen:
                            continue
                        seen.add(item)
                        queue.extend(adjacency[item] - seen)
                    result.update(nodes=len(nodes), edges=len(edges), componentNodes=len(seen), warnings=flow.get('meta', {}).get('warnings', []))
                    if not target:
                        result['status'] = 'broken_node'
                    elif invalid:
                        result['status'] = 'invalid_edges'
                    elif len(seen) != len(nodes):
                        result['status'] = 'disconnected'
                    elif len(nodes) == 1:
                        result['status'] = 'single_evidence'
                    if target:
                        result['target'] = {'filePath': target['filePath'], 'line': target['line']}
                    for node in nodes:
                        file_path = node['filePath']
                        source_path = (ROOT / file_path).resolve()
                        if not source_path.is_relative_to(app_root):
                            result['status'] = 'unrelated_source'
                            break
                        if set(Path(file_path).parts) & {'.preview', '.hvigor', 'oh_modules', 'build'}:
                            result['status'] = 'generated_source'
                            break
                        if file_path not in source_cache:
                            try:
                                source_cache[file_path] = source_path.read_text(encoding='utf-8-sig').splitlines()
                            except OSError:
                                source_cache[file_path] = None
                        lines = source_cache[file_path]
                        if lines is None:
                            result['status'] = 'missing_source'
                            break
                        if node['line'] < 1 or node['line'] > len(lines) or node['code'].strip() != lines[node['line'] - 1].strip():
                            result['status'] = 'invalid_source_line'
                            result['badSource'] = {'filePath': file_path, 'line': node['line']}
                            break
                links.append(result)
    statuses = sorted({link['status'] for link in links})
    return {'status': 'audited', 'links': links, 'counts': {status: sum(link['status'] == status for link in links) for status in statuses}}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=Path, help='JSON list of selected app/runId pairs; default: latest completed run per app')
    parser.add_argument('--output', type=Path, help='Write detailed JSON audit results')
    args = parser.parse_args()
    selected = read(args.runs) if args.runs else None
    if selected is None:
        selected = []
        for app in sorted((ROOT / 'input/app').iterdir()):
            if not app.is_dir():
                continue
            registries = sorted((ROOT / 'output/_runs').glob(app.name + '_*.json'), reverse=True)
            for registry in registries:
                run = read(registry, {})
                if (ROOT / run.get('outputDir', '') / 'privacy_report.json').is_file():
                    selected.append({'app': app.name, **run})
                    break
    results = []
    for run in selected:
        registry = read(ROOT / 'output/_runs' / (run['runId'] + '.json'), {})
        root = ROOT / registry.get('outputDir', run.get('outputDir', ''))
        result = {'app': run['app'], 'runId': run['runId'], 'outputDir': str(root), **audit_run(root)}
        result['errors'] = sum(link['status'] in ERROR_STATUSES for link in result['links']) + int(result['status'] == 'missing_report')
        results.append(result)
        print(f"{result['app']}: {result['runId']}, links={len(result['links'])}, errors={result['errors']}, {result['counts']}")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"Apps={len(results)}, links={sum(len(item['links']) for item in results)}, errors={sum(item['errors'] for item in results)}")
    return 1 if any(item['errors'] for item in results) else 0

if __name__ == '__main__':
    raise SystemExit(main())
