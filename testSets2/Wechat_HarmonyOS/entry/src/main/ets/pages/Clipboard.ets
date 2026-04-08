import { pasteboard } from '@kit.BasicServicesKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { router } from '@kit.ArkUI';

@Entry
@Component
struct ClipboardPage {

  // 获取剪切板数据并输出到日志
  getClipboardData() {
    let systemPasteboard: pasteboard.SystemPasteboard = pasteboard.getSystemPasteboard();

    systemPasteboard.getData((err: BusinessError, pasteData: pasteboard.PasteData) => {
      if (err) {
        hilog.error(0xFF00, 'ClipboardPage', '%{public}s', 'Failed to get PasteData. Cause: ' + err.message);
        return;
      }
      // 获取剪切板的主要文本
      let text: string = pasteData.getPrimaryText();
      hilog.info(0xFF00, 'ClipboardPage', '%{public}s', 'Clipboard Data: ' + text);
    });
  }

  // 页面加载时获取剪切板数据
  aboutToAppear() {
    hilog.info(0xFF00, 'ClipboardPage', '%{public}s', '[LifeCycle] aboutToAppear');
    this.getClipboardData();  // 页面加载时调用获取剪切板数据
  }

  // 构建页面内容
  build() {
    Column() {
      Text('获取剪切板数据并输出到日志')
        .fontSize(24)
        .height(60)
        .margin({ bottom: 16 })

      Button('获取剪切板内容')
        .onClick(() => this.getClipboardData())  // 点击按钮获取剪切板内容
        .width('100%')
        .height(40)
        .margin({ bottom: 16 })

      Button('返回主页面')
        .onClick(() => router.back())  // 点击按钮返回主页面
        .width('100%')
        .height(40)
        .margin({ bottom: 16 })

    }
    .width('100%')
    .height('100%')
    .padding({
      left: 24,
      right: 24
    });
  }
}
