import { connection } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';

connection.getDefaultNet().then((netHandle: connection.NetHandle) => {
  if (netHandle.netId == 0) {
    // 当前没有已连接的网络时，获取的netHandler的netid为0，属于异常场景，此处可以实际情况自行添加一些处理机制。
    return;
  }
  connection.getNetCapabilities(netHandle, (error: BusinessError, data: connection.NetCapabilities) => {
    if (error) {
      console.error(`Failed to get net capabilities. Code:${error.code}, message:${error.message}`);
      return;
    }
    console.info("Succeeded to get data: " + JSON.stringify(data));
  })
}).catch((error: BusinessError) => {
  console.error(JSON.stringify(error));
});

@Entry
@Component
struct Index {
  @State netData: string = '';

  getNetworkCapabilities() {
    connection.getDefaultNet().then((netHandle: connection.NetHandle) => {
      if (netHandle.netId == 0) {
        // 当前没有已连接的网络时，获取的netHandler的netid为0，属于异常场景，此处可以实际情况自行添加一些处理机制。
        return;
      }
      connection.getNetCapabilities(netHandle, (error: BusinessError, data: connection.NetCapabilities) => {
        if (error) {
          console.error(`Failed to get net capabilities. Code:${error.code}, message:${error.message}`);
          return;
        }
        // 将获取到的数据转换为字符串并存储到 netData
        this.netData = JSON.stringify(data);
        console.info("Succeeded to get data: " + this.netData);
      });
    }).catch((error: BusinessError) => {
      console.error(JSON.stringify(error));
    });
  }

  build() {

    Column() {
      Button("点击")
        .onClick(() => {
          this.getNetworkCapabilities();
        })

      Text(this.netData)
        .width(220)
        .height(50)
        .margin({ bottom: 40 })
    }
    // .height('100%')
    // .width('100%')
    .justifyContent(FlexAlign.Center)

  }
}