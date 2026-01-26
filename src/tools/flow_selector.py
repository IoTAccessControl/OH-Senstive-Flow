"""数据流选择工具"""
import json


class FlowSelector:
    """从privacy_flow_analyzer.py的select_privacy_flow_pairs迁移"""

    def select_privacy_flow_pairs(self, results_file: str) -> list:
        """根据隐私数据选择多组起点和终点"""
        with open(results_file, 'r', encoding='utf-8') as f:
            api_results = json.load(f)

        pairs = []

        # 查找隐私相关的API调用
        privacy_apis = []
        for result in api_results:
            code = result.get('call_code', '')
            file_path = result.get('file_path', '')

            # 设备信息
            if 'deviceInfo' in code:
                privacy_apis.append({
                    'type': 'device_info',
                    'file': file_path,
                    'import_line': result.get('import_line'),
                    'call_line': result.get('call_line'),
                    'call_code': code
                })
            # 网络连接
            elif 'connection' in code and 'hasDefaultNetSync' in code:
                privacy_apis.append({
                    'type': 'network_info',
                    'file': file_path,
                    'import_line': result.get('import_line'),
                    'call_line': result.get('call_line'),
                    'call_code': code
                })
            # 路由参数（用户数据）
            elif 'router.getParams' in code:
                privacy_apis.append({
                    'type': 'user_data',
                    'file': file_path,
                    'import_line': result.get('import_line'),
                    'call_line': result.get('call_line'),
                    'call_code': code
                })
            # 传感器
            elif 'sensor.getSensorList' in code:
                privacy_apis.append({
                    'type': 'sensor_info',
                    'file': file_path,
                    'import_line': result.get('import_line'),
                    'call_line': result.get('call_line'),
                    'call_code': code
                })

        # 为每种隐私类型创建起点-终点对
        # 起点: 隐私API调用
        # 终点: hilog输出或数据存储

        for i, api in enumerate(privacy_apis):
            if api['type'] == 'device_info':
                start = (api['file'], api['call_line'], api['call_code'])
                # 终点: 找到同一文件中后续的hilog调用
                end = (api['file'], api['call_line'] + 1, 'hilog.')
                target = "deviceInfo结果"
            elif api['type'] == 'network_info':
                start = (api['file'], api['call_line'], api['call_code'])
                end = (api['file'], api['call_line'] + 2, 'if ')
                target = "网络连接结果"
            elif api['type'] == 'user_data':
                start = (api['file'], api['call_line'], api['call_code'])
                end = (api['file'], api['call_line'] + 1, 'this.')
                target = "路由参数"
            elif api['type'] == 'sensor_info':
                start = (api['file'], api['call_line'], api['call_code'])
                end = (api['file'], api['call_line'] + 1, 'for ')
                target = "传感器列表"
            else:
                continue

            pairs.append({
                'flow_id': len(pairs) + 1,
                'start': start,
                'end': end,
                'target_var': target,
                'api_type': api['type']
            })

        return pairs
