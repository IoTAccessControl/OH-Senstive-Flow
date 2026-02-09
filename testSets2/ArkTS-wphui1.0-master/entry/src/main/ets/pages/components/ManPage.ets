
import router from '@ohos.router';
import CommonConstants from '../../constants/CommonConstants';
import { WaterFlowDataSource } from '../../datasource/WaterFlowDataSource'
import ItemData from '../../viewmodel/ItemData';
@Component
export default struct ManPage {
  @State maxSize: number = 300;
  @State fontSize: number = 24;
  scroller: Scroller = new Scroller();
  datasource: WaterFlowDataSource = new WaterFlowDataSource();
  private itemHeightArray: number[] = [];
  @State num : number = 0;

  @Builder itemFoot() {
    Column() {
      Text(`-----End-----`)
        .fontSize(10)
        .backgroundColor(Color.White)
        .width(CommonConstants.FULL_PARENT)
        .height($r('app.float.small_img_5wh'))
        .align(Alignment.Center)
        .margin({ top: 2 })
    }
  }

  // 随机减少高度
  getSize() {
    let size = this.maxSize - Math.round(Math.random()*50);
    return size;
  }

  // 宽度不变 保持两列
  getItemSizeArray() {
    for (let i = 0; i < 15; i++) {
      this.itemHeightArray.push(this.getSize())
    }
  }

  aboutToAppear() {
    this.getItemSizeArray()
  }

  build() {
    /*瀑布流-商品卡片浏览*/
    WaterFlow({ footer: this.itemFoot.bind(this)}) {
      LazyForEach(this.datasource, (item: ItemData, index : number) => {
        FlowItem() {
          Column() {
            Image(item.img)
              .objectFit(ImageFit.Contain)
            Row(){
              Text('¥'+item.cardPrice)
                .fontColor($r('app.color.red'))
                .height($r('app.float.card_16hg'))
              Text(item.title)
                .fontSize($r('app.float.input_margin_top'))
                .height($r('app.float.card_16hg'))
            }
          }
        }
        .borderRadius($r('app.float.home_swiper_borderRadius'))
        .padding({ bottom: $r('app.float.home_swiper_borderRadius') })
        // .width(this.itemWidthArray[index])//宽度保持不变
        .height(this.itemHeightArray[index])
        .backgroundColor($r('app.color.white'))
        .onClick(()=>{
          router.pushUrl({ url: 'pages/components/CardDetailPage', params: { cardId : item.others } })
        })
      }, item => item)
    }
    .columnsTemplate("1fr 1fr")
    .itemConstraintSize({
      minWidth: 0,
      maxWidth: '100%',
      minHeight: 0,
      maxHeight: '100%'
    })
    .columnsGap(10)
    .rowsGap(5)
    .onReachEnd(() => {
      AlertDialog.show({
        title: "弹窗",
        message: "不好意思，到底了",
        confirm: { value: "", action: () => {}, }
      })
    })
    .padding({ left: $r('app.float.home_list_padding'), bottom: $r('app.float.home_swiper_borderRadius') })
    .width('100%')
    .height(CommonConstants.FULL_PARENT)
    .layoutDirection(FlexDirection.Column)
  }
}
