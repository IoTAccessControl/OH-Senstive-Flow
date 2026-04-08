import { geoLocationManager } from '@kit.LocationKit';
import { BusinessError } from '@kit.BasicServicesKit'
import json from '@ohos.util.json';
import { AuthUtil } from '../Util/AuthUtil';
import { Permissions } from '@kit.AbilityKit';
// import { geoLocationManager } from '@kit.LocationKit';
@Entry
@Component
struct Index {
  locationPermissions: Permissions = 'ohos.permission.LOCATION'
  locationMatelyPermissions: Permissions = 'ohos.permission.APPROXIMATELY_LOCATION'
  @State new_location: string = '';
  @State old_location: string = '';

  async aboutToAppear(): Promise<void> {
    let permissionResult = await this.CheckPermission();
    if (!permissionResult) {
      return;
    }
  }

  async GetLastLocation() {
    try {
      let isLocationEnabled = await geoLocationManager.isLocationEnabled();
      if (!isLocationEnabled) {
        console.error("设备定位未开启，请在系统设置中打开 GPS");
        return;
      }

      let location = await geoLocationManager.getLastLocation();
      this.old_location=json.stringify(location);
      console.log(`获取缓存位置信息:${json.stringify(location)}`);
    } catch (error) {
      console.error("获取缓存位置失败: " + JSON.stringify(error));
    }


  }

  GetSingleLocation() {
    let request: geoLocationManager.SingleLocationRequest = {
      'locatingPriority': geoLocationManager.LocatingPriority.PRIORITY_LOCATING_SPEED,
      'locatingTimeoutMs': 10000
    }
    try {
      geoLocationManager.getCurrentLocation(request).then(
        (result) => { // 调用getCurrentLocation获取当前设备位置，通过promise接收上报的位置
          this.new_location=JSON.stringify(result);
          console.log('current location: ' + JSON.stringify(result));
        })
        .catch((error: BusinessError) => { // 接收上报的错误码
          console.error('promise, getCurrentLocation: error=' + JSON.stringify(error));
        });
    } catch (err) {
      console.error("errCode:" + JSON.stringify(err));
    }
  }


  build() {
    Column() {
      Button("查看系统中缓存的最新位置")
        .width(220)
        .height(50)
        .margin({ bottom: 40 })
        .onClick(() => this.GetLastLocation())
      Button("查看最新位置")
        .width(220).height(50)
        .margin({ bottom: 40 })
        .onClick(() => {
          this.GetSingleLocation()
        })


      Text("最新位置:"+this.new_location) // 最新位置
        .width(220)
        .height(50)
        .margin({ bottom: 170 });

      Text("缓存位置:"+this.old_location) // 显示获取到的相机设备信息
        .width(220)
        .height(50)
        .margin({ bottom: 170 });

    }
    .height('100%')
    .width('100%')
    .justifyContent(FlexAlign.Center)
  }


  private async CheckPermission(): Promise<boolean> {
    let result: boolean = true;
    let locationPermissionCheck = await AuthUtil.checkPermissions(this.locationPermissions)
    if (!locationPermissionCheck) {
      AuthUtil.reqPermissionsFromUser(this.locationPermissions, (index: number) => {
        if (index === -1) {
          result = false;
        }
      })
    }
    if (!result) {
      return result;
    }
    let locationMatelyPermissionCheck = await AuthUtil.checkPermissions(this.locationMatelyPermissions)
    if (!locationMatelyPermissionCheck) {
      AuthUtil.reqPermissionsFromUser(this.locationMatelyPermissions, (index: number) => {
        if (index === -1) {
          result = false;
        }
      })
    }
    return result;
  }
}