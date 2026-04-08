import { sms } from '@kit.TelephonyKit';
import { BusinessError } from '@kit.BasicServicesKit';
//
// let result = sms.hasSmsCapability();
// console.log(`hasSmsCapability: ${JSON.stringify(result)}`);


@Entry
@Component
struct Index {
  @State SMSData: string = '';

  getSMS() {
    sms.getDefaultSmsSimId((err: BusinessError, data: number) => {
      let result = sms.hasSmsCapability();
      // console.log(`hasSmsCapability: ${JSON.stringify(result)}`);
      this.SMSData=` data->${JSON.stringify(data)},hasSmsCapability: ${JSON.stringify(result)}`
      console.log(`data->${JSON.stringify(data)}`);
    });
  }

  build() {

    Column() {
      Button("点击")
        .onClick(() => {
          this.getSMS();
        })

      Text(this.SMSData)
        .width(220)
        .height(50)
        .margin({ bottom: 40 })
    }
    // .height('100%')
    // .width('100%')
    .justifyContent(FlexAlign.Center)

  }
}