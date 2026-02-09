
import CommonConstants from '../../constants/CommonConstants';
import { getSportCardInfo } from '../../datasource/DataUtils';
import { SimpleCardInfo } from '../../viewmodel/DataModels';
@Component
export default struct SportPage {

  private sportCardInfo: Array<SimpleCardInfo> = getSportCardInfo();

  build() {
    ListCardDisplay({sportCardInfo : this.sportCardInfo})
  }
}
@Component
struct ListCardDisplay {
  private sportCardInfo : Array<SimpleCardInfo> = []
  build() {
    List({ space: 20, initialIndex: 0 }) {
      ForEach(this.sportCardInfo, (cardInfo: SimpleCardInfo) => {
        ListItem() {
          Column() {
            Image(cardInfo.image)
              .objectFit(ImageFit.Cover)
              .borderRadius($r('app.float.home_swiper_borderRadius'))
          }
        }
      }, (cardInfo: SimpleCardInfo) => JSON.stringify(cardInfo))
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
    .height(CommonConstants.FULL_PARENT)
  }
}