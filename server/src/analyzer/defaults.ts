import path from 'node:path';

export const DEFAULT_APP_PATH = 'input/app/Wechat_HarmonyOS/';
export const DEFAULT_SDK_PATH = 'input/sdk/default/openharmony/ets/';
export const DEFAULT_CSV_DIR = 'input/csv/';

export const DEFAULT_APP_SCAN_SUBDIR = path.join('entry', 'src', 'main', 'ets');

export const SOURCE_FUNCTION_DESCRIPTIONS: Record<string, string> = {
  build: 'ArkUI 组件的 UI 构建入口函数',
  aboutToAppear: '组件即将显示时触发的生命周期函数',
  aboutToDisappear: '组件即将消失时触发的生命周期函数',
  onPageShow: '页面显示时触发的生命周期函数',
  onPageHide: '页面隐藏时触发的生命周期函数',
  onBackPress: '返回键事件回调（页面/组件）',

  // UIAbility (Stage model) lifecycle
  onCreate: 'UIAbility 创建时触发的生命周期函数',
  onDestroy: 'UIAbility 销毁时触发的生命周期函数',
  onForeground: 'UIAbility 切换到前台时触发的生命周期函数',
  onBackground: 'UIAbility 切换到后台时触发的生命周期函数',
  onWindowStageCreate: 'WindowStage 创建时触发的生命周期函数',
  onWindowStageDestroy: 'WindowStage 销毁时触发的生命周期函数',
  onWindowStageActive: 'WindowStage 获得焦点时触发的生命周期函数',
  onWindowStageInactive: 'WindowStage 失去焦点时触发的生命周期函数',
  onNewWant: '收到新的 Want 时触发的生命周期函数',
  onConfigurationUpdate: '系统配置更新时触发的生命周期函数',
};

