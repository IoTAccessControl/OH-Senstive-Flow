
import CommonConstants from '../constants/CommonConstants';
import ItemData from '../viewmodel/ItemData';
import mainViewModel from '../viewmodel/MainViewModel';


@Component
export default struct Mine {

  build() {
    Scroll() {
      /*个人资料*/
      Column({ space: CommonConstants.COMMON_SPACE }) {
        Row() {
          Image($r('app.media.account'))
            .width($r('app.float.setting_account_size'))
            .height($r('app.float.setting_account_size'))
          Column() {
            Text($r('app.string.setting_account_name'))
              .fontSize($r('app.float.setting_account_fontSize'))
            Text($r('app.string.setting_account_email'))
              .fontSize($r('app.float.little_text_size'))
              .margin({ top: $r('app.float.setting_name_margin') })
          }
          .alignItems(HorizontalAlign.Start)
          .margin({ left: $r('app.float.setting_account_margin') })
        }
        .margin({ top: $r('app.float.setting_list_height')})
        .alignItems(VerticalAlign.Center)
        .width('100%')
        .height($r('app.float.setting_account_height'))
        .backgroundColor(Color.White)
        .padding({left: $r('app.float.setting_account_padding'), right: $r('app.float.setting_account_padding') })
        .borderRadius($r('app.float.setting_account_borderRadius'))
        /*我的订单*/
        Flex({ direction: FlexDirection.Column }) {
          Row(){
            Text(CommonConstants.MY_ORDERS)
              .fontSize(20)
              .fontWeight(FontWeight.Bold)
              .padding({left: $r('app.float.home_grid_padding'),top:$r('app.float.home_grid_padding')})
          }

          Grid() {
            ForEach(mainViewModel.getMimeGridData(), (item: ItemData) => {
              GridItem() {
                Column() {
                  Image(item.img).objectFit(ImageFit.Contain).height($r('app.float.setting_list_height')).width($r('app.float.setting_list_height'))
                  Text(item.title).fontSize($r('app.float.little_text_size')).margin({ top: $r('app.float.home_homeCell_margin') })
                }
              }
            }, (item: ItemData) => JSON.stringify(item))
          }
          .columnsTemplate('1fr 1fr 1fr 1fr').rowsTemplate('1fr').columnsGap($r('app.float.home_grid_columnsGap')).rowsGap($r('app.float.home_grid_rowGap'))
          .height($r('app.float.home_firstGrid_height')).width('100%')
        }
        .width('100%').height('130vp').margin({ left: $r('app.float.home_grid_padding'), right: $r('app.float.home_grid_padding') }).borderRadius($r('app.float.home_grid_borderRadius'))
        .backgroundColor(Color.White)
        /*功能区*/
        Grid() {
          ForEach(mainViewModel.getMimeGridSecondData(), (item: ItemData) => {
            GridItem() {
              Column() {
                Image(item.img).objectFit(ImageFit.Contain).height($r('app.float.setting_account_text_height')).width($r('app.float.setting_account_text_height'))
                Text(item.title).fontSize($r('app.float.little_text_size')).margin({ top: $r('app.float.home_homeCell_margin') })
              }
            }
          }, (item: ItemData) => JSON.stringify(item))
        }
        .columnsTemplate('1fr 1fr 1fr 1fr').rowsTemplate('1fr 1fr').columnsGap($r('app.float.home_grid_columnsGap')).rowsGap($r('app.float.home_grid_rowGap'))
        .margin({left: $r('app.float.home_grid_padding'), right: $r('app.float.home_grid_padding')})
        .height('150vp').width('100%').backgroundColor(Color.White).borderRadius($r('app.float.home_grid_borderRadius'))
        /*分割*/
        Blank()
        /*退出按钮*/
        Button($r('app.string.setting_button'), { type: ButtonType.Capsule })
          .width(CommonConstants.BUTTON_WIDTH)
          .height($r('app.float.login_button_height')).fontSize($r('app.float.normal_text_size')).fontColor($r('app.color.red')).fontWeight(FontWeight.Medium)
          .backgroundColor($r('app.color.grey')).margin({ bottom: $r('app.float.setting_button_bottom')})
      }
      .height(CommonConstants.FULL_PARENT)

    }
  }
}



