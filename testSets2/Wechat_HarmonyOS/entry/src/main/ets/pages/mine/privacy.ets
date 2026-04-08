import router from '@ohos.router'
import ListMenuItem from '../../component/ListMenuItem'
import { PhotoPickerUtils } from '../../utils/PhotoPickerUtils'
import WindowManager from '../../utils/WindowManager'
import { ToastUtils } from '../../utils/ToastUtils'

@Preview
@Component
export default struct privacy {


  // build方法，组件加载时调用获取账户信息方法
  build() {
    Column() {
      Button(){
        Text("input")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }
      .width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/input'})
      })

      Button(){
        Text("input")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }
      .width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/input'})
      })

      Button(){
        Text("WIFI")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)

      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/WIFI'})
      })

      Button(){
        Text("location")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/location'})
      }
      )

      Button(){
        Text("SIM_info")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/SIM'})
      }
      )

      Button(){
        Text("network_info")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/network_info'})
      })

      Button(){
        Text("SMS")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/SMS'})
      })


      Button(){
        Text("bluetooth")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/bluetooth'})
      })

      Button(){
        Text("ssid")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/ssid'})
      })

      Button(){
        Text("camera")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/camera'})
      })


      Button(){
        Text("Contact")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/Contact'})
      })

      Button(){
        Text("Clipboard")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/Clipboard'})
      })

      Button(){
        Text("AccountInfo")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/Account'})
      })

      Button(){
        Text("OAID")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/OAID'})
      })

      Button(){
        Text("sensor")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/sensor'})
      })

      Button(){
        Text("deviceid")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/deviceid'})
      })

      Button(){
        Text("audio")
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
      }.width(170)
      .height(35)
      .margin({ bottom: 5 })
      .onClick(()=>{
        router.pushUrl({url:'pages/audio'})
      })

    }
    .width('100%')
    .height('100%')
    .padding({
      left: 24,
      right: 24
    })
  }
}
