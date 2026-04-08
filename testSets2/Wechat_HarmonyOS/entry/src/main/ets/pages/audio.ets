import { audio } from '@kit.AudioKit';
import { BusinessError } from '@kit.BasicServicesKit';


@Entry
@Component
struct Index {
  @State result: string = '';
  audio(){
    let audioManager: audio.AudioManager = audio.getAudioManager();
    audioManager.getAudioScene((err: BusinessError, value: audio.AudioScene) => {
      if (err) {
        console.error(`Failed to obtain the audio scene mode. ${err}`);
        return;
      }
      this.result=`Callback invoked to indicate that the audio scene mode is obtained ${value}.`
      console.info(`Callback invoked to indicate that the audio scene mode is obtained ${value}.`);
    });
  }


  build() {
    Column() {
      Button("点击获取audio信息")
        .onClick(() => {
          this.audio();
        });

      Text(this.result)
        .width(220)
        .height(50)
        .margin({ bottom: 40 });
    }
    .justifyContent(FlexAlign.Center);
  }
}
