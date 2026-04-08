import { BusinessError } from '@kit.BasicServicesKit';
import { distributedDeviceManager } from '@kit.DistributedServiceKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { router } from '@kit.ArkUI';

@Entry
@Component
struct Index {
  @State result: string = '';
  deviceid(){
    try {
      let dmInstance = distributedDeviceManager.createDeviceManager('zone.yby.seamusic');
      this.result=`dmInstance${JSON.stringify(dmInstance)}`
      console.log(`dmInstance${JSON.stringify(dmInstance)}`);
    } catch(err) {
      let e: BusinessError = err as BusinessError;
      console.error('createDeviceManager errCode:' + e.code + ',errMessage:' + e.message);
    }

    // 获取设备类型
    let deviceTypeInfo: string = deviceInfo.deviceType;
    console.info('Device Type: ' + deviceTypeInfo);
    this.result += "\n"+'Device Type: ' + deviceTypeInfo
    // 获取设备制造商信息
    let manufactureInfo: string = deviceInfo.manufacture;
    console.info('Manufacture: ' + manufactureInfo);
    this.result += "\n"+'Manufacture: ' + manufactureInfo
    // 获取品牌信息
    let brandInfo: string = deviceInfo.brand;
    console.info('Brand: ' + brandInfo);
    this.result += "\n"+'Brand: ' + brandInfo
    // 获取市场名称
    let marketNameInfo: string = deviceInfo.marketName;
    console.info('Market Name: ' + marketNameInfo);
    this.result += "\n"+'Market Name: ' + marketNameInfo

    // 获取设备系列
    let productSeriesInfo: string = deviceInfo.productSeries;
    console.info('Product Series: ' + productSeriesInfo);
    this.result += "\n"+'Product Series: ' + productSeriesInfo
    // 获取产品型号
    let productModelInfo: string = deviceInfo.productModel;
    console.info('Product Model: ' + productModelInfo);
    this.result += "\n"+'Product Model: ' + productModelInfo

    // 获取系统显示版本
    let displayVersionInfo: string = deviceInfo.displayVersion;
    console.info('Display Version: ' + displayVersionInfo);
    this.result += "\n"+'Display Version: ' + displayVersionInfo

    // 获取增量版本
    let incrementalVersionInfo: string = deviceInfo.incrementalVersion;
    console.info('Incremental Version: ' + incrementalVersionInfo);
    this.result += "\n"+'Incremental Version: ' + incrementalVersionInfo
    // 获取 OS 全名
    let osFullNameInfo: string = deviceInfo.osFullName;
    console.info('OS Full Name: ' + osFullNameInfo);
    this.result += "\n"+'OS Full Name: ' + osFullNameInfo

    // 获取安全补丁标签
    let securityPatchTagInfo: string = deviceInfo.securityPatchTag;
    console.info('Security Patch Tag: ' + securityPatchTagInfo);
    this.result += "\n"+'Security Patch Tag: ' + securityPatchTagInfo
    // 获取引导加载程序版本
    let bootloaderVersionInfo: string = deviceInfo.bootloaderVersion;
    console.info('Bootloader Version: ' + bootloaderVersionInfo);
    this.result += "\n"+'Bootloader Version: ' + bootloaderVersionInfo
    //权限不够
    let serialInfo: string = deviceInfo.serial;
    console.info('serialInfo: ' + serialInfo);
    this.result += "\n"+'serialInfo' + serialInfo
    // try {
    //   let dmInstance = distributedDeviceManager.createDeviceManager('ohos.samples.jsHelloWorld');
    //   let deviceId: string = dmInstance.getLocalDeviceId();
    //   this.result='local device id: ' + JSON.stringify(deviceId)
    //   console.log('local device id: ' + JSON.stringify(deviceId));
    //   let deviceName: string = dmInstance.getDeviceName(networkId);
    //   console.log('device name: ' + JSON.stringify(deviceName));
    // } catch (err) {
    //   let e: BusinessError = err as BusinessError;
    //   console.error('getLocalDeviceId errCode:' + e.code + ',errMessage:' + e.message);
    // }
    }



  build() {
    Column() {
      Text("获取账户信息")
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .margin({ bottom: 20 });

      Button("获取账户信息")
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .backgroundColor("#57be6a")
        .width('100%')
        .height(45)
        .borderRadius(5)
        .onClick(() => {
          this.deviceid();  // 点击按钮后获取账户信息
        })

      Button('返回主页面')
        .onClick(() => router.back())  // 点击按钮返回主页面
        .width('100%')
        .height(40)
        .margin({ bottom: 16 })

      Text(this.result)
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
