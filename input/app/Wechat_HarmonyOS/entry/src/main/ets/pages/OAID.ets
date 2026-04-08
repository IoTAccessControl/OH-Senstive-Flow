import { abilityAccessCtrl, common, Permissions, UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { identifier } from '@kit.AdsKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { router } from '@kit.ArkUI';
import { bundleManager } from '@kit.AbilityKit';

// 存储获取的 OAID 数据
let oaidResult: string = '';

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


async function checkPermissions(): Promise<void> {
  let grantStatus1: boolean = await checkPermissionGrant('ohos.permission.APP_TRACKING_CONSENT') === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;// 获取精确定位权限状态

  if (!grantStatus1) {
    // 申请权限
    const context: common.UIAbilityContext = getContext(Index) as common.UIAbilityContext;
    reqPermissionsFromUser(permissions, context);
  }
  else {
    // 已经授权，可以继续访问目标操作
    try {
      // 调用 identifier 获取 OAID
      identifier.getOAID((err: BusinessError, data: string) => {
        if (err.code) {
          // 如果获取失败，输出错误信息
          hilog.error(0x0000, 'testTag', '%{public}s',
            `Failed to get OAID, error: ${err.code} ${err.message}`);
          oaidResult = `Failed to get OAID: ${err.message}`;
        } else {
          // 如果获取成功，输出 OAID
          const oaid: string = data;
          hilog.info(0x0000, 'testTag', '%{public}s', 'Successfully got OAID');
          oaidResult = `OAID: ${oaid}`;
        }
      });
    } catch (err) {
      // 捕获异常并输出错误信息
      hilog.error(0x0000, 'testTag', '%{public}s',
        `Failed to get OAID by callback, catch error: ${err.code} ${err.message}`);
      oaidResult = `Error: ${err.message}`;
    }
  }
}


const permissions: Array<Permissions> = ['ohos.permission.APP_TRACKING_CONSENT'];
// 使用UIExtensionAbility：将common.UIAbilityContext 替换为common.UIExtensionContext

function reqPermissionsFromUser(permissions: Array<Permissions>, context: common.UIAbilityContext): void {
  let atManager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
  // requestPermissionsFromUser会判断权限的授权状态来决定是否唤起弹窗
  atManager.requestPermissionsFromUser(context, permissions).then((data) => {
    let grantStatus: Array<number> = data.authResults;
    let length: number = grantStatus.length;
    for (let i = 0; i < length; i++) {
      if (grantStatus[i] === 0) {
        // 用户授权，可以继续访问目标操作
        try {
          // 调用 identifier 获取 OAID
          identifier.getOAID((err: BusinessError, data: string) => {
            if (err.code) {
              // 如果获取失败，输出错误信息
              hilog.error(0x0000, 'testTag', '%{public}s',
                `Failed to get OAID, error: ${err.code} ${err.message}`);
              oaidResult = `Failed to get OAID: ${err.message}`;
            } else {
              // 如果获取成功，输出 OAID
              const oaid: string = data;
              hilog.info(0x0000, 'testTag', '%{public}s', 'Successfully got OAID');
              oaidResult = `OAID: ${oaid}`;
            }
          });
        } catch (err) {
          // 捕获异常并输出错误信息
          hilog.error(0x0000, 'testTag', '%{public}s',
            `Failed to get OAID by callback, catch error: ${err.code} ${err.message}`);
          oaidResult = `Error: ${err.message}`;
        }

      } else {
        // 用户拒绝授权，提示用户必须授权才能访问当前页面的功能，并引导用户到系统设置中打开相应的权限
        console.log("用户拒绝授权！");
        return;
      }
    }
    // 授权成功
  }).catch((err: BusinessError) => {
    console.error(`Failed to request permissions from user. Code is ${err.code}, message is ${err.message}`);
  })
}


@Entry
@Component
struct Index {

  aboutToAppear() {
    // 使用UIExtensionAbility：将common.UIAbilityContext 替换为common.UIExtensionContext
    const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    reqPermissionsFromUser(permissions, context);
  }

  build() {
    Column() {
      Text('获取 OAID')
        .fontSize(24)
        .fontWeight('bold')
        .margin({ bottom: 20 });

      Button('获取 OAID')
        .width('100%')
        .height(40)
        .onClick(() => checkPermissions())  // 按钮点击时触发获取 OAID 操作
        .margin({ bottom: 20 });

      Text(oaidResult)
        .fontSize(18)
        .fontColor('#0000FF');

      Button('返回主页面')
        .onClick(() => router.back())  // 点击按钮返回主页面
        .width('100%')
        .height(40)
        .margin({ bottom: 16 })

    }
    .width('100%')
    .height('100%')
    .padding({ left: 24, right: 24 });
  }
}