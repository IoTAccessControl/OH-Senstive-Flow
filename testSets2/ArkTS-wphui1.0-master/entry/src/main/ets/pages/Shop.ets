import CommonConstants from '../constants/CommonConstants'
import { getShopCardInfo } from '../datasource/DataUtils';
import { CardInfo } from '../viewmodel/DataModels';

@Component
export default struct Shop {

  private shopCardInfo: Array<CardInfo> = getShopCardInfo();
  @State shopNums : number = 0;
  @State allMoney : number = 0;

  addShopCardInfo(price : number, size : number){
    this.allMoney = this.allMoney + price;
    this.shopNums = this.shopNums + size;
  }

  deleteShopCardInfo(price : number, size : number){
    this.allMoney = this.allMoney - price;
    this.shopNums = this.shopNums - size;
  }

  build(){
    Scroll() {
      Column({ space: CommonConstants.COMMON_SPACE }) {
        /*购物车*/
        Column() {
          Text($r('app.string.shopping_cart'))
            .fontWeight(FontWeight.Medium)
            .fontSize($r('app.float.page_title_text_size'))
            .margin({ top: $r('app.float.mainPage_tabTitles_margin') })
            .padding({ left: $r('app.float.mainPage_tabTitles_padding') })
        }
        .width(CommonConstants.FULL_PARENT)
        .alignItems(HorizontalAlign.Start)

        List({ space: 20, initialIndex: 0 }) {
          ForEach(this.shopCardInfo, (cardInfo: CardInfo) => {
            ListItem() {
              Flex({ direction: FlexDirection.Row  }) {//行布局
                Checkbox({ name: 'checkbox1', group: 'checkboxGroup' })
                  .selectedColor('#007DFF')
                  .borderRadius($r('app.float.home_swiper_borderRadius'))
                  .onChange((value: boolean) => {
                    console.info('Checkbox1 change is' + value)
                    if (value) {
                      this.addShopCardInfo(cardInfo.price, cardInfo.numb);
                    } else {
                      this.deleteShopCardInfo(cardInfo.price, cardInfo.numb);
                    }
                  })
                Image(cardInfo.image)
                  .objectFit(ImageFit.Cover)
                  .width('70vp')
                  .borderRadius($r('app.float.home_swiper_borderRadius'))
                Flex({ direction: FlexDirection.Column  }) {
                  Text(cardInfo.desc)
                    .fontSize('15')
                    .width('200vp')
                  Select([{ value: cardInfo.proper+':'+cardInfo.size },
                    { value: 'bbb'},
                    { value: 'ccc'},
                    { value: 'ddd'}])//打开商品详情页
                    .selected(2)
                    .value(cardInfo.proper+':'+cardInfo.size)
                    .font({ size: 12, weight: 500 })
                    .fontColor('#182431')
                    .selectedOptionFont({ size: 12, weight: 400 })
                    .optionFont({ size: 12, weight: 400 })

                  Text('¥' +cardInfo.price)
                    .fontSize('15')
                    .fontColor(Color.Red)

                  Text('X' +cardInfo.numb)
                    .fontSize('12').padding({left:'80%'})
                }.margin({left:'15vp'})

              }
            }.backgroundColor(Color.White)
            .borderRadius($r('app.float.setting_account_borderRadius'))
          }, (cardInfo: CardInfo) => JSON.stringify(cardInfo))
        }
        .listDirection(Axis.Vertical) // 排列方向
        .divider({ strokeWidth: 2, color: 0xFFFFFF, startMargin: 20, endMargin: 20 }) // 每行之间的分界线
        .edgeEffect(EdgeEffect.Spring) // 滑动到边缘无效果
        .padding({
          top: $r('app.float.home_list_padding'),
          left: $r('app.float.home_list_padding'),
          right: $r('app.float.home_list_padding')
        })
        .width(CommonConstants.FULL_PARENT)
        .height('70%')

        /*结算*/
        Row(){
          Text('已选' + this.shopNums)

          Text('总计：¥' + this.allMoney).fontColor(Color.Red).padding({left:'20vp'})

          Button(('结算'), { type: ButtonType.Capsule })
            .width('40%')
            .height($r('app.float.login_button_height')).fontSize($r('app.float.normal_text_size')).fontColor($r('app.color.red')).fontWeight(FontWeight.Medium)
            .backgroundColor($r('app.color.grey'))
            .onClick(()=>{
              AlertDialog.show({
                title: "购物车结算弹窗",
                message: "您一共买了"+this.shopNums+"件商品，总价值："+this.allMoney+"元。",
                confirm: { value: "", action: () => {}, }
              })
            })
        }

      }
    }
  }
}