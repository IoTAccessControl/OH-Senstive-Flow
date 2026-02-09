import UIAbility from '@ohos.app.ability.UIAbility';
import type Want from '@ohos.app.ability.Want';
import hilog from '@ohos.hilog';
import window from '@ohos.window';
import { WindowManager } from '../utils/WindowManager';
import { ImageKnife, ImageKnifeDrawFactory } from '@ohos/imageknife'
import { CustomEngineKeyImpl } from './CustomEngineKeyImpl';
import { BLog } from '../utils/BLog';
import connection from '@ohos.net.connection';
import bundleManager from '@ohos.bundle.bundleManager';

export default class EntryAbility extends UIAbility {
    private netConn: connection.NetConnection | undefined;

    onCreate(want: Want, launchParam: Object) {
        hilog.info(0x0000, 'testTag', '%{public}s', 'Ability onCreate');
        globalThis.appContext = this.context;
        globalThis.resourceMana = this.context.resourceManager;
        try {
            // 检查ImageKnife是否已初始化且with方法存在
            if (ImageKnife && typeof ImageKnife.with === 'function') {
                globalThis.ImageKnife = ImageKnife.with(this.context);
                if (globalThis.ImageKnife) {
                    if (typeof globalThis.ImageKnife.setDefaultLifeCycle === 'function') {
                        globalThis.ImageKnife.setDefaultLifeCycle(ImageKnifeDrawFactory.createProgressLifeCycle("#10a5ff", 0.5));
                    }
                    if (typeof globalThis.ImageKnife.setEngineKeyImpl === 'function') {
                        globalThis.ImageKnife.setEngineKeyImpl(new CustomEngineKeyImpl());
                    }
                }
            }
        } catch (error) {
            BLog.e("ImageKnife initialization error: " + JSON.stringify(error));
        }
    }

    onDestroy() {
        hilog.info(0x0000, 'testTag', '%{public}s', 'Ability onDestroy');
        this.netConnUnregister();
    }

    onWindowStageCreate(windowStage: window.WindowStage) {
        // Main window is created, set main page for this ability
        hilog.info(0x0000, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

        globalThis.windowStage = windowStage;
        globalThis.filesDir = this.context.filesDir;
        BLog.init(this.context.filesDir);
        AppStorage.SetOrCreate("netIsAvailable", true);
        this.netConnRegister();
        this.getAppBundleInfo();

        WindowManager.setLayoutFullScreen(false, WindowManager.COLOR_WHITE,
            WindowManager.COLOR_BLACK, WindowManager.COLOR_WHITE, WindowManager.COLOR_BLACK);

        windowStage.loadContent('pages/Splash', (err, data) => {
            if (err.code) {
                hilog.error(0x0000, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err) ?? '');
                return;
            }
            hilog.info(0x0000, 'testTag', 'Succeeded in loading the content. Data: %{public}s', JSON.stringify(data) ?? '');
        });
    }

    onWindowStageDestroy() {
        // Main window is destroyed, release UI related resources
        hilog.info(0x0000, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
    }

    onForeground() {
        // Ability has brought to foreground
        hilog.info(0x0000, 'testTag', '%{public}s', 'Ability onForeground');
    }

    onBackground() {
        // Ability has back to background
        hilog.info(0x0000, 'testTag', '%{public}s', 'Ability onBackground');
    }

    netConnRegister() {
        let netCap: connection.NetCapabilities = {
            bearerTypes: [connection.NetBearType.BEARER_CELLULAR, connection.NetBearType.BEARER_WIFI],
            networkCap: [connection.NetCap.NET_CAPABILITY_INTERNET]
        };
        let netSpec: connection.NetSpecifier = {
            netCapabilities: netCap
        };
        let timeout = 5 * 1000;
        this.netConn = connection.createNetConnection(netSpec, timeout);
        this.netConn?.on('netAvailable', (data => {
            BLog.i("net is available, netId is " + data.netId);
            AppStorage.SetOrCreate("netIsAvailable", true);
        }));
        this.netConn?.on('netUnavailable', (data => {
            BLog.i("net is unavailable, data is " + JSON.stringify(data));
            AppStorage.SetOrCreate("netIsAvailable", false);
        }));
        this.netConn?.register((err, data) => { });
    }

    netConnUnregister() {
        this.netConn?.unregister((err, data) => { });
    }

    getAppBundleInfo() {
        try {
            bundleManager.getBundleInfoForSelf(0).then(info => {
                BLog.i(`app info name: ${info.name}, versionName: ${info.versionName}`);
                AppStorage.SetOrCreate("appTargetVersion", info.targetVersion);
                AppStorage.SetOrCreate("appBundleName", info.name);
                AppStorage.SetOrCreate("appVersionName", info.versionName);
                AppStorage.SetOrCreate("appVendor", info.vendor);
            })
        } catch (err) {
            BLog.e(`getBundleInfo failed: ${err.message}`);
        }
    }
}
