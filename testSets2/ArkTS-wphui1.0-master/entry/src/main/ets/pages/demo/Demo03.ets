import mainViewModel from '../../viewmodel/MainViewModel';
import ItemData from '../../viewmodel/ItemData';
import CommonConstants from '../../constants/CommonConstants';

@Component
export default struct Demo03 {
  private swiperController: SwiperController = new SwiperController();
  private tabsController: TabsController = new TabsController();
  @State opacityValue : number = 1;

  /*装饰器 - 展示TabContent*/
  @Builder BuildTabContent(index : number, istabcontent : boolean) {
    Grid() {
      ForEach(mainViewModel.getWomanPageData(index), (item: ItemData) => {
        GridItem() {
          Column() {
            Image(item.img)
              .width($r('app.float.small_img_5wh'))
              .height(istabcontent ? $r('app.float.small_img_8hg') : $r('app.float.small_img_3hg'))
            Text(item.title)
              .fontSize($r('app.float.little_text_size'))
              .margin({ top: $r('app.float.home_homeCell_margin') })
          }.backgroundColor(istabcontent ? null : Color.White)
        }
      }, (item: ItemData) => JSON.stringify(item))
    }
    .columnsTemplate('1fr 1fr 1fr 1fr')
    .rowsTemplate('1fr 1fr')
    .columnsGap($r('app.float.home_grid_columnsGap'))
    .rowsGap($r('app.float.home_grid_columnsGap'))
    .padding({ bottom: $r('app.float.home_grid_padding') })
    .height(istabcontent ? $r('app.float.tab_250hg') : $r('app.float.tab_180hg'))
    .backgroundColor(istabcontent ? Color.White : null)
    .borderRadius($r('app.float.home_grid_borderRadius'))
  }

  /*装饰器 - 展示轮播图*/
  @Builder BuildSwiper() {
    Swiper(this.swiperController) {
      ForEach(mainViewModel.getWomanPagesSwiperImages(), (img: Resource) => {
        Image(img)
          .height('200vp')
          .width(CommonConstants.FULL_PARENT)
          .borderRadius($r('app.float.home_swiper_borderRadius'))
      }, (img: Resource) => JSON.stringify(img.id))
    }
    .margin({ top: $r('app.float.home_swiper_margin') })
    .autoPlay(true)
    .opacity(this.opacityValue);
  }

  build() {
    Scroll() {
      Column({ space: CommonConstants.COMMON_SPACE }) {
        /*Button('ChangeOpacity', { type: ButtonType.Capsule, stateEffect: true })
          .backgroundColor($r('app.color.white'))
          .width(200).height(30).border({width:1}).fontColor($r('app.color.title_text_color'))
          .onClick(()=>{
            if (this.opacityValue == 1) {
              this.opacityValue = 0.01;
            } else {
              this.opacityValue = 1;
            }
          })*/

        /*轮播图*/
        this.BuildSwiper()
        /*精选分类*/
        Tabs({ barPosition: BarPosition.Start, controller: this.tabsController }) {
          /*精选分类 tab*/
          TabContent(){
            this.BuildTabContent(0, true)
          }.tabBar(CommonConstants.Category_TITLE1)
          /*上装 tab*/
          TabContent(){
            this.BuildTabContent(1, true)
          }.tabBar(CommonConstants.Category_TITLE2)
          /*下装 tab*/
          TabContent(){
            this.BuildTabContent(2, true)
          }.tabBar(CommonConstants.Category_TITLE3)
        }.height('300vp')
        .padding({ left: $r('app.float.home_list_padding'), right: $r('app.float.home_list_padding') })
        /*块状品牌*/
        LogoDisplay().opacity(this.opacityValue);
        Blank();
        Blank();
      }
      .height(CommonConstants.FULL_PARENT)
    }
  }
}

/*自定义组件-show Gird Logo Info*/
@Component
struct LogoDisplay {
  build(){
    Grid() {
      ForEach(mainViewModel.getWomanBrandData(), (item: ItemData) => {
        GridItem() {
          Column() {
            Image(item.img)
              .width($r('app.float.small_img_5wh'))
              .height($r('app.float.small_img_3hg'))
            Text(item.title)
              .fontSize($r('app.float.little_text_size'))
              .margin({ top: $r('app.float.home_homeCell_margin') })
          }
        }
        .backgroundColor(Color.White)
      }, (item: ItemData) => JSON.stringify(item))
    }
    .columnsTemplate('1fr 1fr 1fr 1fr')
    .rowsTemplate('1fr 1fr')
    .columnsGap($r('app.float.home_grid_columnsGap'))
    .rowsGap($r('app.float.home_grid_rowGap'))
    .padding({
      left: $r('app.float.home_grid_padding'),
      right: $r('app.float.home_grid_padding'),
      bottom: $r('app.float.home_grid_padding')
    })
    .height($r('app.float.tab_180hg'))
    .borderRadius($r('app.float.home_grid_borderRadius'))
  }
}
