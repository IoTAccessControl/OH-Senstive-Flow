"""分类工具"""
import os
import json
from pathlib import Path
from collections import defaultdict


# API类型到功能模块英文名称的映射
API_TYPE_TO_MODULE = {
    "device_info": "device_info",
    "network_info": "network_info",
    "location_info": "location_info",
    "sensor_info": "sensor_info",
    "display_info": "display_info",
    "file_info": "file_info",
    "media_info": "media_info",
    "contact_info": "contact_info",
    "calendar_info": "calendar_info",
    "call_log_info": "call_log_info",
    "sms_info": "sms_info",
    "bluetooth_info": "bluetooth_info",
    "wifi_info": "wifi_info",
    "nfc_info": "nfc_info",
    "account_info": "account_info",
    "app_info": "app_info",
    "system_info": "system_info",
    "user_info": "user_info",
    "notification_info": "notification_info",
    "clipboard_info": "clipboard_info",
}


class DataFlowClassifier:
    """从classify_and_distribute.py迁移"""

    def get_all_api_types(self, data_flow_file: str) -> set:
        """从data_flow_results.json获取所有API类型"""
        with open(data_flow_file, 'r', encoding='utf-8') as f:
            flows = json.load(f)
        api_types = set()
        for flow in flows:
            if 'api_type' in flow:
                api_types.add(flow['api_type'])
        return api_types

    def analyze_source_files(self, data_dir: str) -> dict:
        """
        分析data目录下的鸿蒙app源码，返回每个文件的功能模块分类
        """
        file_modules = {}

        # 功能模块关键词映射（用于分析源码确定功能模块）
        module_keywords = {
            "device_info": ["device", "DeviceInfo", "getDeviceInfoSync"],
            "network_info": ["connection", "Connection", "hasDefaultNetSync", "getNetCapabilities"],
            "location_info": ["location", "Location", "getCurrentLocation"],
            "sensor_info": ["sensor", "Sensor", "getSensorList"],
            "display_info": ["display", "Display", "getDefaultDisplaySync"],
            "file_info": ["file", "fileIo", "getFileStorage"],
            "media_info": ["media", "Media", "audio", "camera"],
            "contact_info": ["contact", "Contact", "rdb", "datastore"],
            "account_info": ["account", "Account", "osAccount"],
            "wifi_info": ["wifi", "Wifi", "wifi"],
            "bluetooth_info": ["bluetooth", "Bluetooth", "ble"],
            "nfc_info": ["nfc", "Nfc"],
        }

        for root, dirs, files in os.walk(data_dir):
            for file in files:
                if file.endswith('.ets'):
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()

                        detected_modules = set()
                        for module, keywords in module_keywords.items():
                            for keyword in keywords:
                                if keyword.lower() in content.lower():
                                    detected_modules.add(module)
                                    break

                        if detected_modules:
                            file_modules[file_path] = detected_modules
                    except Exception as e:
                        print(f"Error reading {file_path}: {e}")

        return file_modules

    def classify_data_flows(self, data_flow_file: str) -> dict:
        """
        根据api_type分类数据流
        返回: {功能模块: [数据流列表]}
        """
        with open(data_flow_file, 'r', encoding='utf-8') as f:
            flows = json.load(f)

        classified = defaultdict(list)
        for flow in flows:
            api_type = flow.get('api_type', 'unknown')
            module = API_TYPE_TO_MODULE.get(api_type, api_type)
            classified[module].append(flow)

        return dict(classified)

    def distribute_data_flows(self, data_flow_file: str, results_dir: str):
        """
        根据功能模块分类搬运数据流到对应目录
        """
        os.makedirs(results_dir, exist_ok=True)

        # 分类数据流
        classified_flows = self.classify_data_flows(data_flow_file)

        # 创建各功能模块目录并保存数据流
        for module, flows in classified_flows.items():
            module_dir = os.path.join(results_dir, module)
            os.makedirs(module_dir, exist_ok=True)

            output_file = os.path.join(module_dir, 'data_flow_results.json')
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(flows, f, ensure_ascii=False, indent=2)

            print(f"Created {output_file} with {len(flows)} data flows")

        return classified_flows

    def generate_module_summary(self, data_dir: str, classified_flows: dict) -> dict:
        """
        生成功能模块摘要信息
        """
        file_modules = self.analyze_source_files(data_dir)

        summary = {
            "source_files_analyzed": len(file_modules),
            "modules_found": list(classified_flows.keys()),
            "file_module_mapping": {}
        }

        for file_path, modules in file_modules.items():
            rel_path = os.path.relpath(file_path, data_dir)
            summary["file_module_mapping"][rel_path] = list(modules)

        return summary
