import { common, Context } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { camera } from '@kit.CameraKit';

function getCameraManager(context: common.BaseContext): camera.CameraManager | undefined {
  let cameraManager: camera.CameraManager | undefined = undefined;
  try {
    cameraManager = camera.getCameraManager(context);
  } catch (error) {
    let err = error as BusinessError;
    console.error(`The getCameraManager call failed. error code: ${err.code}`);
  }
  return cameraManager;
}

function getSupportedCameras(cameraManager: camera.CameraManager): Array<camera.CameraDevice> {
  let cameras: Array<camera.CameraDevice> = [];
  try {
    cameras = cameraManager.getSupportedCameras();
  } catch (error) {
    let err = error as BusinessError;
    console.error(`The getSupportedCameras call failed. error code: ${err.code}`);
  }
  return cameras;
}

@Entry
@Component
struct Index {
  @State cameraData: string = ''; // 用于存储相机设备信息的状态

  private context = getContext(this) as common.BaseContext;

  // 获取相机设备信息
  getSMS() {
    if (this.context) {
      let cameraManager = getCameraManager(this.context); // 获取相机管理器
      if (cameraManager) {
        let cameras = getSupportedCameras(cameraManager); // 获取相机设备列表
        this.cameraData = JSON.stringify(cameras); // 将相机设备信息转换为字符串，并更新状态
        console.log(`获取相机：${this.cameraData}`)
      } else {
        this.cameraData = 'No camera manager available';
      }
    }
  }
  //
  build() {
    Column() {
      Button("点击获取相机设备")
        .onClick(() => {
          // 在按钮点击时获取相机设备信息
          this.getSMS();
        });

      Text(this.cameraData) // 显示获取到的相机设备信息
        .width(220)
        .height(50)
        .margin({ bottom: 40 });
    }
    .justifyContent(FlexAlign.Center);
  }
}
