import mainViewModel from '../../viewmodel/MainViewModel';
import ItemData from '../../viewmodel/ItemData';
import CommonConstants from '../../constants/CommonConstants';

@Component
export default struct HomePage {
  private swiperController: SwiperController = new SwiperController();

  build() {
    Scroll() {
      Column({ space: CommonConstants.COMMON_SPACE }) {
        /*轮播图*/
        Swiper(this.swiperController) {
          ForEach(mainViewModel.getMainPagesSwiperImages(), (img: Resource) => {
            Image(img)
              .height('200vp')
              .width(CommonConstants.FULL_PARENT)
              .borderRadius($r('app.float.home_swiper_borderRadius'))
          }, (img: Resource) => JSON.stringify(img.id))
        }
        .margin({ top: $r('app.float.home_swiper_margin') })
        .autoPlay(true)
        /*大牌闪购+发现好物*/
        Grid() {
          ForEach(mainViewModel.getFirstGridData(), (firstItem: ItemData) => {
            GridItem() {
              Column() {
                Row(){
                  Image($r('app.media.love'))
                    .width($r('app.float.setting_account_size'))
                    .height($r('app.float.setting_account_size'))
                  Text(firstItem.title)
                    .fontSize($r('app.float.normal_text_size'))
                    .fontWeight(FontWeight.Bolder)
                  Text(firstItem.others)
                    .margin({ left: $r('app.float.home_list_padding') })
                    .fontSize($r('app.float.little_text_size'))
                    .fontColor($r('app.color.home_grid_fontColor'))
                }
                Text(firstItem.others)
                  .margin({ top: $r('app.float.home_list_margin') })
                  .fontSize($r('app.float.little_text_size'))
                  .fontColor($r('app.color.home_grid_fontColor'))
              }
              .alignItems(HorizontalAlign.Start)
            }
            .padding({ top: $r('app.float.home_list_padding'), left: $r('app.float.home_list_padding') })
            .borderRadius($r('app.float.home_backgroundImage_borderRadius'))
            .align(Alignment.TopStart)
            .backgroundImage(firstItem.img)
            .backgroundImageSize(ImageSize.Cover)
            .width(CommonConstants.FULL_PARENT)
            .height(CommonConstants.FULL_PARENT)
          }, (firstItem: ItemData) => JSON.stringify(firstItem))
        }
        .width(CommonConstants.FULL_PARENT)
        .height($r('app.float.home_firstGrid_height'))
        .columnsTemplate('1fr 1fr')
        .rowsTemplate('1fr')
        .columnsGap($r('app.float.home_grid_columnsGap'))
        .rowsGap($r('app.float.home_grid_rowGap'))
        // .margin({ bottom: $r('app.float.setting_button_bottom') })

        /*今日特卖--start--*/
        Text('今日特卖')
          .fontSize($r('app.float.normal_text_size'))
          .fontWeight(FontWeight.Medium)
          .width(CommonConstants.FULL_PARENT)
          .margin({ left: $r('app.float.home_text_margin') })
        /*今日特卖*/
        List({ space: 20, initialIndex: 0 }) {
          ForEach(mainViewModel.getSecondGridData(), (firstItem: ItemData) => {
            ListItem() {
              Column(){
                Image(firstItem.img)
                  .height('100vp')
                  .width('100vp')
                  .borderRadius($r('app.float.home_swiper_borderRadius'))
                Row(){
                  Text('特卖')
                    .fontSize($r('app.float.small_text_size'))
                    .fontWeight(FontWeight.Medium)
                    // .fontColor($r('app.color.red'))
                    // .backgroundColor($r('app.color.yellow'))
                    // .width($r('app.float.normal_text_size'))
                  Text(firstItem.title)
                    .margin({ left: $r('app.float.home_list_padding') })
                    .fontSize($r('app.float.little_text_size'))
                    .fontColor($r('app.color.home_grid_fontColor'))
                    // .backgroundColor($r('app.color.red'))
                }
                .backgroundImage($r('app.media.title_money'))
                .borderRadius($r('app.float.home_grid_columnsGap'))
                .backgroundImageSize(ImageSize.Cover)
                Text(firstItem.others)
                  .margin({ top: $r('app.float.home_list_margin') })
                  .fontSize($r('app.float.little_text_size'))
                  // .fontColor($r('app.color.home_grid_fontColor'))
                  .fontWeight(FontWeight.Bolder)
              }
            }
          }, (firstItem: ItemData) => JSON.stringify(firstItem))
        }.listDirection(Axis.Horizontal) // 排列方向
        .divider({ strokeWidth: 2, color: 0xFFFFFF, startMargin: 20, endMargin: 20 }) // 每行之间的分界线
        .edgeEffect(EdgeEffect.Spring) // 滑动到边缘无效果
        .padding({ top: $r('app.float.home_list_padding'), left: $r('app.float.home_list_padding') })
        .width('100%')
        .backgroundColor($r('app.color.white'))
        /*今日特卖--end--*/

        /*今日特卖--start--*/
        // Row(){
          Text('发现频道')
            .fontSize($r('app.float.normal_text_size'))
            .fontWeight(FontWeight.Medium)
            .width(CommonConstants.FULL_PARENT)
            .margin({ left: $r('app.float.home_text_margin') })
          /*今日特卖*/
          List({ space: 20, initialIndex: 0 }) {
            ForEach(mainViewModel.getSecondGridData(), (firstItem: ItemData) => {
              ListItem() {
                Column(){
                  Image(firstItem.img)
                    .height('100vp')
                    .width('100vp')
                    .borderRadius($r('app.float.home_swiper_borderRadius'))
                  Row(){
                    Text('特卖')
                      .fontSize($r('app.float.normal_text_size'))
                      .fontWeight(FontWeight.Bolder)
                    Text(firstItem.title)
                      .margin({ left: $r('app.float.home_list_padding') })
                      .fontSize($r('app.float.little_text_size'))
                      .fontColor($r('app.color.home_grid_fontColor'))
                  }
                  // @ts-ignore
                  Text(firstItem.others)
                    .margin({ top: $r('app.float.home_list_margin') })
                    .fontSize($r('app.float.little_text_size'))
                    .fontColor($r('app.color.home_grid_fontColor'))
                }
              }
            }, (firstItem: ItemData) => JSON.stringify(firstItem))
          }.listDirection(Axis.Horizontal) // 排列方向
          .divider({ strokeWidth: 2, color: 0xFFFFFF, startMargin: 20, endMargin: 20 }) // 每行之间的分界线
          .edgeEffect(EdgeEffect.Spring) // 滑动到边缘无效果
          .onScrollIndex((firstIndex: number, lastIndex: number) => {
            console.info('first' + firstIndex)
            console.info('last' + lastIndex)
          })
          .padding({ top: $r('app.float.home_list_padding'), left: $r('app.float.home_list_padding') })
          .width('100%')
        // }.justifyContent(FlexAlign.Center)
        // .backgroundColor(0xAFEEEE)

        /*今日特卖--end--*/

        /*卡片推荐*/
        List({ space: 5, initialIndex: 0 }) {
          ForEach(mainViewModel.getListCardData(), (listCardData: ItemData) => {
            ListItem() {Column() {}}
            .backgroundImage(listCardData.img)
            .backgroundImageSize(ImageSize.Auto)
            .padding({ top: $r('app.float.home_list_padding'), left: $r('app.float.home_list_padding'), right: $r('app.float.home_list_padding') })
            .borderRadius($r('app.float.home_backgroundImage_borderRadius'))
            .height($r('app.float.home_grid_height'))
            .width(CommonConstants.FULL_PARENT)
          }, (listCardData: ItemData) => JSON.stringify(listCardData))
        }.listDirection(Axis.Vertical) // 排列方向
        .edgeEffect(EdgeEffect.Spring) // 滑动到边缘无效果
        .padding({ top: $r('app.float.home_list_padding'), left: $r('app.float.home_list_padding'), right:$r('app.float.home_list_padding') })
        .width(CommonConstants.FULL_PARENT)
        .height(CommonConstants.FULL_PARENT)
      }
    }
    .height(CommonConstants.FULL_PARENT)

  }
}