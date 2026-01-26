#!/usr/bin/env python3
import os
import re
import json

def get_imports(lines):
    """提取所有import语句及其行号"""
    imports = {}
    for i, line in enumerate(lines, 1):
        match = re.match(r'\s*import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+[\'"]([^\'"]+)[\'"]', line)
        if match:
            module = match.group(1)
            imports[module] = {'line': i, 'code': line.strip()}
    return imports

def is_harmony_import(import_code):
    """判断是否为鸿蒙相关导入"""
    return '@ohos' in import_code or '@kit' in import_code or 'harmonyos' in import_code.lower()

def analyze_file(file_path):
    """分析单个文件，找出鸿蒙API调用"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        lines = content.split('\n')

        imports = get_imports(lines)
        results = []

        for i, line in enumerate(lines, 1):
            # 跳过import语句本身
            if i in [imp['line'] for imp in imports.values()]:
                continue

            # 查找所有来自鸿蒙模块的API调用
            for imp_module, imp_info in imports.items():
                if not is_harmony_import(imp_info['code']):
                    continue

                # 提取导入的类/函数名
                import_line = imp_info['code']
                # 处理 named imports: import { A, B } from '@ohos.xxx'
                named_imports = re.findall(r'\{([^}]+)\}', import_line)
                # 处理 default import: import X from '@ohos.xxx'
                default_import = re.match(r'\s*import\s+(\w+)', import_line)
                # 处理 aliased imports: import { A as B } from '@ohos.xxx'
                aliased_imports = re.findall(r'\{[^}]*?\b(\w+)\s+as\s+(\w+)[^}]*\}', import_line)

                all_import_names = []
                for named in named_imports:
                    for name in named.split(','):
                        name = name.strip().split(' as ')[0].strip()
                        if name:
                            all_import_names.append(name)
                if default_import:
                    all_import_names.append(default_import.group(1))
                for orig, alias in aliased_imports:
                    all_import_names.append(alias)

                # 检查当前行是否使用了这些导入
                for imported_name in all_import_names:
                    # 匹配模式: importedName(...) 或 importedName.xxx
                    if re.search(r'\b' + imported_name + r'\s*\(', line) or \
                       re.search(r'\b' + imported_name + r'\.', line):
                        results.append({
                            'file_path': file_path,
                            'import_line': imp_info['line'],
                            'import_code': import_line,
                            'call_line': i,
                            'call_code': line.strip()
                        })
                        break

        return results
    except Exception as e:
        print(f"Error analyzing {file_path}: {e}")
        return []

def main():
    data_dir = 'data'
    results_dir = 'results'

    os.makedirs(results_dir, exist_ok=True)

    ets_files = []
    for root, dirs, files in os.walk(data_dir):
        for file in files:
            if file.endswith('.ets'):
                ets_files.append(os.path.join(root, file))

    all_results = []
    for file_path in ets_files:
        results = analyze_file(file_path)
        all_results.extend(results)

    output_path = os.path.join(results_dir, 'harmony_api_results.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)

    print(f"Analyzed {len(ets_files)} files")
    print(f"Found {len(all_results)} HarmonyOS API calls")
    print(f"Results saved to {output_path}")

if __name__ == '__main__':
    main()
