"""鸿蒙API分析工具"""
import os
import re
import json
import csv
from pathlib import Path
from typing import Optional, Dict, List, Tuple


class DtsDescriptionLoader:
    """从SDK .d.ts文件加载API描述"""

    def __init__(self, sdk_path: str):
        self.sdk_path = Path(sdk_path)
        self.api_index: Dict[str, Dict[str, str]] = {}
        self._loaded = False

    def load_all_descriptions(self):
        """加载所有.d.ts文件的描述"""
        if self._loaded:
            return

        # 加载 api/ 目录下的 .d.ts 文件
        api_dir = self.sdk_path / "api"
        if api_dir.exists():
            self._load_dts_files(api_dir)

        # 加载 kits/ 目录下的 .d.ts 文件
        kits_dir = self.sdk_path / "kits"
        if kits_dir.exists():
            self._load_kit_files(kits_dir)

        self._loaded = True

    def _load_dts_files(self, directory: Path):
        """递归加载.d.ts文件"""
        for dts_file in directory.rglob("*.d.ts"):
            self._parse_dts_file(dts_file)

    def _load_kit_files(self, directory: Path):
        """加载kit文件（处理re-export）"""
        for kit_file in directory.glob("*.d.ts"):
            self._parse_kit_file(kit_file)

    def _parse_dts_file(self, file_path: Path):
        """解析单个.d.ts文件"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception:
            return

        # 提取namespace
        namespace_match = re.search(r'declare\s+namespace\s+(\w+)', content)
        if not namespace_match:
            return

        namespace = namespace_match.group(1)

        # 查找所有 JSDoc + function 组合
        # 使用更简单的模式匹配 /** ... */ 然后查找后面的 function
        jsdoc_pattern = r'/\*\*.*?\*/'
        for jsdoc_match in re.finditer(jsdoc_pattern, content, re.DOTALL):
            jsdoc_block = jsdoc_match.group(0)
            # 获取 JSDoc 后面的内容，查找 function 声明
            after_jsdoc = content[jsdoc_match.end():]
            # 查找最近的 function 声明（跳过空格和换行）
            func_match = re.search(r'\bfunction\s+(\w+)\s*\(', after_jsdoc)
            if func_match:
                func_name = func_match.group(1)
                description = self._extract_description_from_jsdoc(jsdoc_block)

                if description:
                    if namespace not in self.api_index:
                        self.api_index[namespace] = {}
                    self.api_index[namespace][func_name] = description

    def _parse_kit_file(self, file_path: Path):
        """解析kit文件，追踪re-export"""
        # Kit文件通常会re-export来自其他@ohos模块的内容
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception:
            return

        # 提取import语句以建立模块映射
        # import xxx from '@ohos.xxx'
        import_pattern = r"import\s+(\w+)\s+from\s+['\"](@ohos\.[^'\"]+)['\"]"
        for match in re.finditer(import_pattern, content):
            exported_name = match.group(1)
            source_module = match.group(2)
            # 这里可以建立映射，简化处理暂不存储

    def _extract_description_from_jsdoc(self, jsdoc: str) -> str:
        """从JSDoc注释中提取描述"""
        lines = jsdoc.split('\n')
        for line in lines:
            # 去除行首的 * 字符和空白
            line = line.strip()
            # 跳过 /** 和 */ 标记行
            if line in ('/**', '*/', '*'):
                continue
            # 去除行首的 *
            line = line.lstrip('*').strip()
            # 返回第一个非空、非@开头的行
            if line and not line.startswith('@'):
                return line
        return ""

    def get_description(self, namespace: str, function_name: str) -> Optional[str]:
        """获取API描述"""
        if namespace in self.api_index and function_name in self.api_index[namespace]:
            return self.api_index[namespace][function_name]
        return None


class CsvDescriptionLoader:
    """从CSV文件加载API描述"""

    def __init__(self, csv_path: str):
        self.csv_path = Path(csv_path)
        self.api_index: Dict[str, str] = {}
        self._loaded = False

    def load_descriptions(self):
        """加载CSV文件"""
        if self._loaded:
            return

        if not self.csv_path.exists():
            self._loaded = True
            return

        try:
            with open(self.csv_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    api = row.get('相关API', '')
                    behavior = row.get('行为子项', row.get('敏感行为', ''))

                    if api and behavior:
                        # 从API签名中提取函数名
                        func_name = self._extract_function_name(api)
                        if func_name:
                            key = func_name.lower()
                            self.api_index[key] = behavior
        except Exception as e:
            print(f"Warning: Failed to load CSV: {e}")

        self._loaded = True

    def _extract_function_name(self, api_signature: str) -> Optional[str]:
        """从API签名中提取函数名"""
        # 例如: @ohos.hilog.info(...) -> hilog.info
        match = re.search(r'@ohos\.([^.]+)\.(\w+)', api_signature)
        if match:
            return f"{match.group(1)}.{match.group(2)}"

        # 例如: hilog.info(...) -> hilog.info
        match = re.search(r'(\w+)\.(\w+)\s*\(', api_signature)
        if match:
            return f"{match.group(1)}.{match.group(2)}"

        return None

    def get_description(self, namespace: str, function_name: str) -> Optional[str]:
        """获取API描述"""
        key = f"{namespace}.{function_name}".lower()
        return self.api_index.get(key)


class ConfigDescriptionLoader:
    """从配置文件加载API描述（兜底）"""

    def __init__(self, config_path: str):
        self.config_path = Path(config_path)
        self.api_index: Dict[str, Dict[str, str]] = {}
        self._loaded = False

    def load_descriptions(self):
        """加载配置文件"""
        if self._loaded:
            return

        if not self.config_path.exists():
            self._loaded = True
            return

        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self.api_index = json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load config: {e}")

        self._loaded = True

    def get_description(self, namespace: str, function_name: str) -> Optional[str]:
        """获取API描述"""
        if namespace in self.api_index and function_name in self.api_index[namespace]:
            return self.api_index[namespace][function_name]
        return None


class ApiDescriptionLookup:
    """API描述查找服务（三级查找）"""

    def __init__(self, sdk_path: str, csv_path: str, config_path: str):
        self.dts_loader = DtsDescriptionLoader(sdk_path)
        self.csv_loader = CsvDescriptionLoader(csv_path)
        self.config_loader = ConfigDescriptionLoader(config_path)

    def load_all(self):
        """加载所有数据源"""
        self.dts_loader.load_all_descriptions()
        self.csv_loader.load_descriptions()
        self.config_loader.load_descriptions()

    def get_description(self, import_code: str, call_code: str) -> str:
        """
        获取API描述
        查找顺序: SDK -> CSV -> 配置文件 -> 默认值
        """
        namespace, function = self._parse_api_call(import_code, call_code)

        if not namespace or not function:
            return "API function call"

        # 1. 尝试从SDK .d.ts文件获取
        desc = self.dts_loader.get_description(namespace, function)
        if desc:
            return desc

        # 2. 尝试从CSV文件获取
        desc = self.csv_loader.get_description(namespace, function)
        if desc:
            return desc

        # 3. 尝试从配置文件获取
        desc = self.config_loader.get_description(namespace, function)
        if desc:
            return desc

        return "API function call"

    def _parse_api_call(self, import_code: str, call_code: str) -> Tuple[Optional[str], Optional[str]]:
        """
        解析API调用，提取命名空间和函数名

        返回: (namespace, function_name)
        """
        # 模式1: namespace.function(...) - 如 hilog.info(...)
        match = re.search(r'(\w+)\.(\w+)\s*\(', call_code)
        if match:
            namespace, function = match.group(1), match.group(2)

            # 如果命名空间是导入的别名，尝试从import中获取原始命名空间
            original_namespace = self._get_original_namespace(import_code, namespace)
            return original_namespace or namespace, function

        # 模式2: 直接函数调用 - 如 createAVPlayer(...)
        match = re.search(r'(\w+)\s*\(', call_code)
        if match:
            function = match.group(1)
            namespace = self._extract_namespace_from_import(import_code, function)
            return namespace, function

        return None, None

    def _get_original_namespace(self, import_code: str, alias: str) -> Optional[str]:
        """从import语句中获取原始命名空间"""
        # import hilog from '@ohos.hilog' -> hilog
        match = re.search(r'import\s+(\w+)\s+from\s+[\'"]([^\'"]+)[\'"]', import_code)
        if match and match.group(1) == alias:
            return match.group(1)

        # import { info } from '@ohos.hilog'
        match = re.search(r'import\s+\{[^}]*\s+(\w+)\s+\}\s+from\s+[\'"]([^\'"]+)[\'"]', import_code)
        if match and match.group(1) == alias:
            # 从模块路径提取命名空间
            module_path = match.group(2)
            parts = module_path.split('.')
            return parts[-1] if parts else None

        return None

    def _extract_namespace_from_import(self, import_code: str, function: str) -> Optional[str]:
        """从import语句中提取命名空间"""
        # import hilog from '@ohos.hilog'
        match = re.search(r'import\s+(\w+)\s+from\s+[\'"](@[^\'"]+)[\'"]', import_code)
        if match:
            return match.group(1)

        # import { xxx } from '@kit.AbilityKit'
        match = re.search(r'import\s+\{[^}]*\}\s+from\s+[\'"](@[^\'"]+)[\'"]', import_code)
        if match:
            return match.group(1)

        return None


class HarmonyApiAnalyzer:
    """鸿蒙API分析工具（增强版）"""

    def __init__(self, data_dir: str, sdk_path: Optional[str] = None,
                 csv_path: Optional[str] = None, config_path: Optional[str] = None):
        self.data_dir = data_dir

        # 配置路径（支持环境变量和默认值）
        project_root = Path(__file__).parent.parent.parent
        self.sdk_path = sdk_path or os.environ.get('HARMONY_SDK_PATH',
                                                       str(project_root / 'sdk' / 'default' / 'openharmony' / 'ets'))
        self.csv_path = csv_path or os.environ.get('API_PERMISSION_CSV_PATH',
                                                       str(project_root / 'data' / 'api_and_permission.csv'))
        self.config_path = config_path or str(project_root / 'src' / 'data' / 'api_descriptions.json')

        # 初始化API描述查找服务
        self.description_lookup = ApiDescriptionLookup(
            self.sdk_path,
            self.csv_path,
            self.config_path
        )
        self.description_lookup.load_all()

    def get_imports(self, lines):
        """提取所有import语句及其行号"""
        imports = {}
        for i, line in enumerate(lines, 1):
            match = re.match(r'\s*import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+[\'"]([^\'"]+)[\'"]', line)
            if match:
                module = match.group(1)
                imports[module] = {'line': i, 'code': line.strip()}
        return imports

    def is_harmony_import(self, import_code):
        """判断是否为鸿蒙相关导入"""
        return '@ohos' in import_code or '@kit' in import_code or 'harmonyos' in import_code.lower()

    def analyze_file(self, file_path):
        """分析单个文件，找出鸿蒙API调用"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            lines = content.split('\n')

            imports = self.get_imports(lines)
            results = []

            for i, line in enumerate(lines, 1):
                # 跳过import语句本身
                if i in [imp['line'] for imp in imports.values()]:
                    continue

                # 查找所有来自鸿蒙模块的API调用
                for imp_module, imp_info in imports.items():
                    if not self.is_harmony_import(imp_info['code']):
                        continue

                    # 提取导入的类/函数名
                    import_line = imp_info['code']
                    named_imports = re.findall(r'\{([^}]+)\}', import_line)
                    default_import = re.match(r'\s*import\s+(\w+)', import_line)
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
                        if re.search(r'\b' + imported_name + r'\s*\(', line) or \
                           re.search(r'\b' + imported_name + r'\.', line):
                            # 获取API描述
                            api_description = self.description_lookup.get_description(
                                import_line,
                                line.strip()
                            )

                            results.append({
                                'file_path': file_path,
                                'import_line': imp_info['line'],
                                'import_code': import_line,
                                'call_line': i,
                                'call_code': line.strip(),
                                'api_description': api_description
                            })
                            break

            return results
        except Exception as e:
            print(f"Error analyzing {file_path}: {e}")
            return []

    def analyze_all(self):
        """分析所有文件"""
        ets_files = []
        for root, dirs, files in os.walk(self.data_dir):
            for file in files:
                if file.endswith('.ets'):
                    ets_files.append(os.path.join(root, file))

        all_results = []
        for file_path in ets_files:
            results = self.analyze_file(file_path)
            all_results.extend(results)

        return all_results, len(ets_files)
