import { AsyncCallback, BusinessError } from '@kit.BasicServicesKit';
import { access } from '@kit.ConnectivityKit';
import { baseProfile } from '@kit.ConnectivityKit';
// import { AsyncCallback, BusinessError } from '@kit.BasicServicesKit';
import { a2dp } from '@kit.ConnectivityKit';
import { router } from '@kit.ArkUI';

@Entry
@Component
struct Index {
  @State blueData: string = '';
  @State error: string = '';
  getblue_info() {
    try {
      access.enableBluetooth();
    } catch (err) {
      this.error='errCode: ' + (err as BusinessError).code + ', errMessage: ' + (err as BusinessError).message+`该配置文件在当前设备环境不支持。`
      console.error('errCode: ' + (err as BusinessError).code + ', errMessage: ' + (err as BusinessError).message);
    }

    try {
      let state  = access.getState();
      this.blueData=JSON.stringify(state)
      console.log(`blueData: info->${JSON.stringify(state)}`);

    } catch (err) {
      console.error('errCode: ' + (err as BusinessError).code + ', errMessage: ' + (err as BusinessError).message+`该配置文件在当前设备环境不支持。`);
    }

  //蓝牙开关开启不了
    try {
      let a2dpSrc = a2dp.createA2dpSrcProfile();
      let retArray = a2dpSrc.getConnectedDevices();
      this.blueData+="\n"+"getConnectedDevices "+JSON.stringify(retArray)
    } catch (err) {
      this.blueData+="\n"+"errCode a2dpSrc:" + (err as BusinessError).code + ",errMessage:" + (err as BusinessError).message
      console.error("errCode:" + (err as BusinessError).code + ",errMessage:" + (err as BusinessError).message);
    }

  }


  build() {
    Column() {
      Text("获取蓝牙信息")
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .margin({ bottom: 20 });

      Button("获取bluetooth信息")
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .backgroundColor("#57be6a")
        .width('100%')
        .height(45)
        .borderRadius(5)
        .onClick(() => {
          this.getblue_info();  // 点击按钮后获取账户信息
        })

      Button('返回主页面')
        .onClick(() => router.back())  // 点击按钮返回主页面
        .width('100%')
        .height(40)
        .margin({ bottom: 16 })

      Text(this.blueData+'\n'+this.error)
        .width(220)
        .height(50)
        .margin({ bottom: 40 });

    }
    .width('100%')
    .height('100%')
    .padding({
      left: 24,
      right: 24
    })
  }
}