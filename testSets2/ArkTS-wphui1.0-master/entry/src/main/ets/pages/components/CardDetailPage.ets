import router from '@ohos.router';
import { CardInfo, ProperColorData } from '../../viewmodel/DataModels';
import ItemData from '../../viewmodel/ItemData';
import { getCardInfo, getProperColorData, getProperSizeData } from '../../datasource/DataUtils'
import CommonConstants from '../../constants/CommonConstants';


@Entry
@Component
struct CardDetailPage {
  @State cardId : string  = router.getParams()['cardId'];
  @StorageProp('currentBreakpoint') currentBreakpoint: string = 'sm'
  private cardInfo: CardInfo = getCardInfo(this.cardId);

  build(){
    Scroll() {
      Column() {
        PageTitle()
        CardImageDisplay({ cardInfo: this.cardInfo })
        CardContentDisplay({ cardInfo: this.cardInfo })
        Blank()
        Blank()
        CardProperDisplay()
        CustomerLocationDisplay()
      }
      .alignItems(HorizontalAlign.Center)
    }
    .backgroundColor('#EDF2F5')
    .height('100%')
    .align(Alignment.Top)
  }

}
/*返回*/
@Component
struct PageTitle {
  build() {
    Row() {
      Image($r('app.media.back'))
        .width(20)
        .height(20)
        .onClick(() => {
          router.back()
        })
    }
    .padding(12)
    .width('100%')
  }
}
/*展示Imge*/
@Component
struct CardImageDisplay {
  private cardInfo : CardInfo = new CardInfo(1,'','',null);
  @State imageBgColorA: number = 0
  @StorageProp('currentBreakpoint') currentBreakpoint: string = 'sm'

  build() {
    Stack({ alignContent: Alignment.BottomStart }) {
      Image(this.cardInfo.image!)
        .backgroundColor(`rgba(255, 255, 255, ${this.imageBgColorA})`)
        .borderRadius($r('app.float.home_swiper_borderRadius'))
        .objectFit(ImageFit.Contain)
    }
    .height(this.currentBreakpoint == 'lg' ? 166 : 280)
  }
}
/*展示价格+标题*/
@Component
struct CardContentDisplay {
  private cardInfo : CardInfo = new CardInfo(1,'','',null);
  @State imageBgColorA: number = 0
  @StorageProp('currentBreakpoint') currentBreakpoint: string = 'lg'

  build() {
    Column({ space: CommonConstants.COMMON_SPACE }) {
      Text('¥' +this.cardInfo.price)
        .fontSize(20)
        .fontColor($r('app.color.red'))
        .fontWeight(FontWeight.Bold)
        .margin({top: 18 })
      Text(this.cardInfo.name)
        .fontSize($r('app.float.margin_top'))
        .fontWeight(FontWeight.Bold)
      Text(this.cardInfo.desc)
        .fontSize($r('app.float.margin_top'))
    }
    .padding({ left:$r('app.float.home_swiper_borderRadius') , bottom: $r('app.float.home_swiper_borderRadius') , right : $r('app.float.home_swiper_borderRadius') })
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.white'))
    .borderRadius($r('app.float.home_swiper_borderRadius'))
    .width(CommonConstants.FULL_PARENT)
    .height(150)
  }
}
/*展示属性参数*/
@Component
struct CardProperDisplay {
  @State cardSize : number = 1;

  build() {
    Column({ space: CommonConstants.COMMON_SPACE }) {
      /*颜色*/
      Row(){Text(CommonConstants.COLOR_TITLE).fontSize(20).fontWeight(FontWeight.Bolder).padding({left:$r('app.float.home_grid_padding')})}
      GridProperColorData();
      /*尺码*/
      Row(){Text(CommonConstants.SIZE_TITLE).fontSize(20).fontWeight(FontWeight.Bolder).padding({left:$r('app.float.home_grid_padding')})}
      GridProperSizeData();
      /*数量*/
      Row(){
        Text(CommonConstants.ORDER_SIZE_TITLE).fontSize(20)
          .fontWeight(FontWeight.Bolder)
          .padding({left:$r('app.float.home_grid_padding'), right:'50%'})
        /*减操作 - Button*/
        Button('-', { type: ButtonType.Capsule, stateEffect: true })
          .backgroundColor($r('app.color.white'))
          .width(30)
          .height(20)
          .border({width:1})
          .fontColor($r('app.color.title_text_color'))
          .padding({right:$r('app.float.home_swiper_borderRadius')})
          .onClick(()=>{
            if (this.cardSize > 1) {
              this.cardSize = this.cardSize - 1;
            }
          })
        /*数量值*/
        Text(this.cardSize+'').fontSize(20)
          .fontWeight(FontWeight.Normal)
          .padding({left:$r('app.float.home_grid_padding'), right:$r('app.float.home_grid_padding')})
        /*加操作 - Button*/
        Button('+', { type: ButtonType.Capsule, stateEffect: true })
          .backgroundColor($r('app.color.white'))
          .width(30)
          .height(20)
          .border({width:1})
          .fontColor($r('app.color.title_text_color'))
          .padding({right:$r('app.float.home_grid_padding')})
          .onClick(()=>{
            this.cardSize = this.cardSize + 1;
          })
      }
      .height('50vp')
    }
    .borderRadius($r('app.float.home_swiper_borderRadius'))
    .backgroundColor(Color.White)
    .height('350vp')
    .alignItems(HorizontalAlign.Start)
  }
}

/*颜色参数*/
@Component
struct GridProperColorData{
  build(){
    Grid() {
      ForEach(getProperColorData(), (proper: ProperColorData) => {
        GridItem() {
          Row() {
            Image(proper.image)
              .width('20vp')
              .height('20vp')
            Text(proper.name)
              .fontSize($r('app.float.little_text_size'))
              .margin({ left: $r('app.float.home_homeCell_margin') })
              .fontWeight(FontWeight.Medium)
          }
        }.border({ width: 1 })
        .borderColor($r('app.color.grey'))
        .height($r('app.float.margin_bottom'))
        .width('100vp')
        .borderRadius($r('app.float.home_text_margin'))

      }, (item: ItemData) => JSON.stringify(item))
    }
    .columnsTemplate('1fr 1fr 1fr')
    .rowsTemplate('1fr 1fr')
    .columnsGap($r('app.float.home_grid_columnsGap'))
    .rowsGap($r('app.float.home_grid_rowGap'))
    .padding({
      right: $r('app.float.home_grid_padding'),
    })
    .height('100vp')
    .borderRadius($r('app.float.home_grid_borderRadius'))
    .multiSelectable(true)
  }
}
/*尺码参数*/
@Component
struct GridProperSizeData{
  build(){
    Grid() {
      ForEach(getProperSizeData(), (properSize: number) => {
        GridItem() {
          Text(properSize+'')
            .fontSize($r('app.float.little_text_size'))
            .margin({ left: $r('app.float.home_homeCell_margin') })
            .fontWeight(FontWeight.Medium)
        }.border({ width: 1 })
        .borderColor($r('app.color.grey'))
        .height('30vp')
        .width('100vp')
        .borderRadius($r('app.float.home_text_margin'))
      }, (item: ItemData) => JSON.stringify(item))
    }
    .columnsTemplate('1fr 1fr 1fr')
    .rowsTemplate('1fr 1fr 1fr')
    .columnsGap($r('app.float.home_grid_columnsGap'))
    .rowsGap($r('app.float.home_grid_rowGap'))
    .padding({
      right: $r('app.float.home_grid_padding'),
    })
    .height('110vp')
    .borderRadius($r('app.float.home_grid_borderRadius'))
    .multiSelectable(true)
  }
}

/*地址*/
@Component
struct CustomerLocationDisplay {
  build() {
    Row(){
      Text('此处是地址信息').fontSize(20)
        .fontWeight(FontWeight.Bolder)
        .padding({left:$r('app.float.home_grid_padding')})
    }
    .padding(12)
    .width('100%')
  }
}