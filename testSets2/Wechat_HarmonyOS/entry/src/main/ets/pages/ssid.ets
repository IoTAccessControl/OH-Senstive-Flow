import { wifiManager } from '@kit.ConnectivityKit';

import { abilityAccessCtrl, bundleManager, Permissions } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';


async function checkPermissionGrant(permission: Permissions): Promise<abilityAccessCtrl.GrantStatus> {
  let atManager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
  let grantStatus: abilityAccessCtrl.GrantStatus = abilityAccessCtrl.GrantStatus.PERMISSION_DENIED;

  // 获取应用程序的accessTokenID
  let tokenId: number = 0;
  try {
    let bundleInfo: bundleManager.BundleInfo = await bundleManager.getBundleInfoForSelf(bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION);
    let appInfo: bundleManager.ApplicationInfo = bundleInfo.appInfo;
    tokenId = appInfo.accessTokenId;
  } catch (error) {
    const err: BusinessError = error as BusinessError;
    console.error(`Failed to get bundle info for self. Code is ${err.code}, message is ${err.message}`);
  }

  // 校验应用是否被授予权限
  try {
    grantStatus = await atManager.checkAccessToken(tokenId, permission);
  } catch (error) {
    const err: BusinessError = error as BusinessError;
    console.error(`Failed to check access token. Code is ${err.code}, message is ${err.message}`);
  }

  return grantStatus;
}

async function checkPermissions(): Promise<boolean> {
  let grantStatus1: abilityAccessCtrl.GrantStatus = await checkPermissionGrant('ohos.permission.GET_WIFI_INFO');
  return grantStatus1 === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
}

@Entry
@Component
struct Index {
  @State result: string = '';

  async getssid_info() {
    try {
      let scanInfoList = wifiManager.getScanInfoList();
      console.info("scanInfoList:" + JSON.stringify(scanInfoList));
      this.result=JSON.stringify(scanInfoList)
      let len = scanInfoList.length;
      console.log("wifi received scan info: " + len);
      if (len > 0) {
        for (let i = 0; i < len; ++i) {
          console.info("ssid: " + scanInfoList[i].ssid);
          console.info("bssid: " + scanInfoList[i].bssid);
          console.info("capabilities: " + scanInfoList[i].capabilities);
          console.info("securityType: " + scanInfoList[i].securityType);
          console.info("rssi: " + scanInfoList[i].rssi);
          console.info("band: " + scanInfoList[i].band);
          console.info("frequency: " + scanInfoList[i].frequency);
          console.info("channelWidth: " + scanInfoList[i].channelWidth);
          console.info("timestamp: " + scanInfoList[i].timestamp);
          console.info("supportedWifiCategory: " + scanInfoList[i].supportedWifiCategory);
          console.info("isHiLinkNetwork: " + scanInfoList[i].isHiLinkNetwork);
        }
      }
    } catch (error) {
      console.error("failed:" + JSON.stringify(error));
    }
  }

  async onClickGetWifiInfo() {
    const hasPermission = await checkPermissions();
    if (!hasPermission) {
      console.log("权限未授予，正在申请...");

    } else {
      this.getssid_info();
    }
  }

  build() {
    Column() {
      Button("点击获取Wi-Fi信息")
        .onClick(() => {
          this.onClickGetWifiInfo(); // 按钮点击时调用权限检查和Wi-Fi信息获取
        });

      Text(this.result)
        .width(220)
        .height(50)
        .margin({ bottom: 40 });
    }
    .justifyContent(FlexAlign.Center);
  }
}
