import mainViewModel from '../../viewmodel/MainViewModel';
import ItemData from '../../viewmodel/ItemData';
import CommonConstants from '../../constants/CommonConstants';

@Entry
@Component
export default struct Demo01 {
  private swiperController: SwiperController = new SwiperController();
  @State opacityValue : number = 1;


  build() {
    Scroll() {
      Column({ space: CommonConstants.COMMON_SPACE }) {

        /*轮播图*/
        SwiperDisplay({swiperController:this.swiperController}).opacity(this.opacityValue);

        /*大牌闪购+发现好物*/
        // TitleDisplay({title : ''}).opacity(this.opacityValue);
        GridContentDisplay().opacity(this.opacityValue);

        /*今日特卖*/
        TitleDisplay({title : '今日特卖'}).opacity(this.opacityValue);
        LeftListContentDisplay().opacity(this.opacityValue);

        /*卡片推荐*/
        // TitleDisplay({title : '广告卡片-List'});
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
        }
        .listDirection(Axis.Vertical) // 排列方向
        .edgeEffect(EdgeEffect.Spring) // 滑动到边缘无效果
        .padding({ top: $r('app.float.home_list_padding'), left: $r('app.float.home_list_padding'), right:$r('app.float.home_list_padding') })
        .width(CommonConstants.FULL_PARENT)
        // .height(CommonConstants.FULL_PARENT)

        FootDisplay()
      }
    }
    .height('100%')
    .backgroundColor(0xF1F3F5)

  }
}

@Component
struct LeftListContentDisplay {
  build(){
    Column() {
      List({ space: 20, initialIndex: 0 }) {
        ForEach(mainViewModel.getSecondGridData(), (firstItem: ItemData) => {
          ListItem() {
            Column(){
              Image(firstItem.img)
                .height('100vp')
                .width('100vp')
                .borderRadius($r('app.float.home_swiper_borderRadius'))//图片组件
              Row(){
                Text('特卖')
                  .fontSize($r('app.float.small_text_size'))
                  .fontWeight(FontWeight.Medium)
                Text(firstItem.title)
                  .margin({ left: $r('app.float.home_list_padding') })
                  .fontSize($r('app.float.little_text_size'))
                  .fontColor($r('app.color.home_grid_fontColor'))
              }
              .backgroundImage($r('app.media.title_money'))
              .borderRadius($r('app.float.home_grid_columnsGap'))
              .backgroundImageSize(ImageSize.Cover)
              Text(firstItem.others)
                .margin({ top: $r('app.float.home_list_margin') })
                .fontSize($r('app.float.little_text_size'))
                .fontWeight(FontWeight.Bolder)
            }
          }
        }, (firstItem: ItemData) => JSON.stringify(firstItem))
      }
      .listDirection(Axis.Horizontal) // 排列方向
      .divider({ strokeWidth: 2, color: 0xFFFFFF, startMargin: 20, endMargin: 20 }) // 每行之间的分界线
      .edgeEffect(EdgeEffect.Spring) // 滑动到边缘无效果
      .padding({ left: $r('app.float.home_list_padding') })
      .width('100%')
    }
  }
}

@Component
struct GridContentDisplay {
  build() {
    Grid() {
      ForEach(mainViewModel.getFirstGridData(), (firstItem: ItemData) => {
        GridItem() {
          Column() {
            Row(){
              Image($r('app.media.love')).width($r('app.float.setting_account_size')).height($r('app.float.setting_account_size')) //红心
              Text(firstItem.title).fontSize($r('app.float.normal_text_size'))
                .fontWeight(FontWeight.Bolder) //品牌名
              Text(firstItem.others).margin({ left: $r('app.float.home_list_padding') }).fontSize($r('app.float.little_text_size'))
                .fontColor($r('app.color.home_grid_fontColor'))//品牌详情
            }
            Text(firstItem.others).margin({ top: $r('app.float.home_list_margin') }).fontSize($r('app.float.little_text_size'))
              .fontColor($r('app.color.home_grid_fontColor'))//内容
          }
          .alignItems(HorizontalAlign.Start)
        }
        .padding({ top: $r('app.float.home_list_padding'), left: $r('app.float.home_list_padding') })
        .borderRadius($r('app.float.home_backgroundImage_borderRadius'))
        .align(Alignment.TopStart)
        .backgroundImage(firstItem.img)       //GridItem 背景图
        .backgroundImageSize(ImageSize.Cover) //GridItem 背景图大小
        .width(CommonConstants.FULL_PARENT)   //GridItem 宽度
        .height(CommonConstants.FULL_PARENT)  //GridItem 高度
      }, (firstItem: ItemData) => JSON.stringify(firstItem))
    }
    .width('95%')//Grid宽度
    .height($r('app.float.home_firstGrid_height'))//Grid高度
    .columnsTemplate('1fr 1fr')//两列
    .rowsTemplate('1fr')//1行
    .columnsGap($r('app.float.home_grid_columnsGap'))//设置列与列的间距
    .rowsGap($r('app.float.home_grid_rowGap'))//设置行与行的间距
  }
}

@Component
struct SwiperDisplay {
  swiperController: SwiperController = new SwiperController();

  build(){
    Column() {
      // Text('容器组件Swiper：鸿蒙轮播图')
      //   .fontSize($r('app.float.normal_text_size'))
      //   .fontWeight(FontWeight.Normal)
      //   .width(CommonConstants.FULL_PARENT)
      //   .margin({ top: $r('app.float.home_text_margin'), left: $r('app.float.home_text_margin')})

      /*轮播图*/
      Swiper(this.swiperController) {
        ForEach(mainViewModel.getMainPagesSwiperImages(), (img: Resource) => {
          Image(img)
            .height('200vp') //轮播图高度
            .width(CommonConstants.OTHER_PARENT)    //轮播图宽度
            .borderRadius($r('app.float.home_swiper_borderRadius')) //圆角
        }, (img: Resource) => JSON.stringify(img.id))
      }
      // .margin({ top: $r('app.float.home_swiper_margin') })
      .indicator(true) //导航点
      .autoPlay(true) //自动切换
      .interval(3000) //default = 3000
    }
  }
}

@Component
struct TitleDisplay {
  @State title : string = '';
  build(){
    Column() {
      Text(this.title)
        .fontSize($r('app.float.normal_text_size'))
        .fontWeight(FontWeight.Normal)
        .width(CommonConstants.FULL_PARENT)
        .margin({ left: $r('app.float.home_text_margin')})
    }
  }
}

@Component
struct FootDisplay{
  build(){
    Column() {
      TitleDisplay({title : '开发语言：ArkTS'})
      TitleDisplay({title : '开发平台：DevEco Studio 3.1.1 Release'})
      TitleDisplay({title : '手机系统：HarmonyOS'})
    }
  }
}