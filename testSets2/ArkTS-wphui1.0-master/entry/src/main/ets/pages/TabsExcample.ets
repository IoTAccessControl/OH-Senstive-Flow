// xxx.ets
import HomePage from './components/HomePage'
import ManPage from './components/ManPage'
import SportPage from './components/SportPage'
import Shop from './Shop'
@Entry
@Component
struct TabContentExample {
  @State fontColor: string = '#182431'
  @State selectedFontColor: string = '#007DFF'
  @State currentIndex: number = 0
  private controller: TabsController = new TabsController()
  @State showIndex : boolean = true;
  @State expandBottomLength : boolean = false;


  @Builder TabBuilder(index: number) {
    Column() {
      Image($r('sys.media.ohos_app_icon'))
        .width(24)
        .height(24)
        .margin({ bottom: 4 })
        .objectFit(ImageFit.Contain)
      Text(`Tab${index + 1}`)
        .fontColor(this.currentIndex === index ? this.selectedFontColor : this.fontColor)
        .fontSize(10)
        .fontWeight(500)
        .lineHeight(14)

    }.width('100%')
  }

  resetVisibleAndLength(index : number){
    if (index != 0) {
      this.showIndex = false;
      this.expandBottomLength = true;
      console.log('this.index' + index)
      console.log('this.showIndex' + this.showIndex)
      console.log('this.expandBottomLength' + this.expandBottomLength)
    } else {
      this.showIndex = true;
      this.expandBottomLength = false;
    }
  }


  build() {
    Column() {
      Column() {
        Tabs({ barPosition: BarPosition.Start}) {
          TabContent() {
            HomePage()
          }.tabBar('推荐1')

          TabContent() {
            ManPage()
          }.tabBar('推荐2')

        }
        .vertical(false)
        .barHeight(56)
        .width('100%')
        .backgroundColor('#F1F3F5')
        .margin({ top: 38 })
      }.width('100%').height('90%')
      .visibility(this.showIndex ? Visibility.Visible : Visibility.None)

      Column() {
        Tabs({ barPosition: BarPosition.End, controller: this.controller }) {
          TabContent() {
            Column() {
              // HomePage()
            }.width('100%')
          }.tabBar(this.TabBuilder(0))

          TabContent() {
            SportPage().width('100%').height('100%')
          }.tabBar(this.TabBuilder(1))

          TabContent() {
            SportPage()
          }.tabBar(this.TabBuilder(2))

          TabContent() {
            SportPage()
          }.tabBar(this.TabBuilder(3))

        }
        .vertical(false)
        .barHeight(56)
        .onChange((index: number) => {
          this.currentIndex = index
          this.resetVisibleAndLength(index)
        })
        .width('100%')
        .backgroundColor('#F1F3F5')
      }.width('100%')
      .height(this.expandBottomLength ? '100%' : '50vp')
    }
  }
}

