import { Want } from '@kit.AbilityKit';
// import { deviceInfo } from '@kit.BasicServicesKit';

import { deviceInfo } from '@kit.MDMKit'



@Entry
@Component
struct Index {
  @State result1: string = '';
  SIM() {
      let wantTemp: Want = {
        bundleName: 'zone.yby.seamusic', // 应用包名
        abilityName: 'EntryAbility', // 入口能力名
      };
    // com.OpenHarmony.app.test
    try {
      // 获取设备名称
      let result: string = deviceInfo.getDeviceInfo(wantTemp, 'simInfo');
      console.log(`Succeeded in getting device name, result: ${result}`);
    } catch (err) {
      this.result1 = `Failed to get device name. Code: ${err.code}, message: ${err.message}`
      console.error(`Failed to get device name. Code: ${err.code}, message: ${err.message}`);
    }

  }


  build() {
    Column() {
      Button("点击获取deviceid信息")
        .onClick(() => {
          this.SIM();
        });

      Text(this.result1)
        .width(220)
        .height(50)
        .margin({ bottom: 40 });
    }
    .justifyContent(FlexAlign.Center);
  }
}
