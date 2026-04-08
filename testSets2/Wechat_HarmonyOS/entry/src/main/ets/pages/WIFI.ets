
import { wifiManager } from '@kit.ConnectivityKit';
import { router } from '@kit.ArkUI';

@Entry
@Component
struct Index {
  @State message: string = 'Hello World';
  @State data: string = "获取WIFI信息";

  // 异步方法获取 Wi-Fi 信息
  async fetchWifiInfo() {
    try {
      const data = await wifiManager.getLinkedInfo();
      this.data = `Wi-Fi 信息: ${JSON.stringify(data)}`;
    } catch (error) {
      console.error("获取 Wi-Fi 信息失败", error);
      this.data = "获取Wi-Fi信息失败";
    }
  }

  build() {
    Flex({
      direction: FlexDirection.Column, // 纵向排列
      justifyContent: FlexAlign.SpaceBetween, // 让内容分布在顶部和底部
    }) {
      // 顶部 Wi-Fi 信息按钮
      Text(this.data)
        .id('WiFiInfo')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .backgroundColor("#ffffff")
        .width('80%')
        .height('80%')
        .onClick(() => {
          this.fetchWifiInfo();
        });

      // 返回按钮
      Button("返回")
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .backgroundColor("#ffffff")
        // .width('100%')
        // .height('20%')
        .borderRadius(5)
        .onClick(() => {
          router.back();
        });
    }
    .height('100%')
    .width('100%')






  }
}


