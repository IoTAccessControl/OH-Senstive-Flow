
import CommonConstants from '../constants/CommonConstants';
import WomanPage from './components/WomanPage'
import ManPage from './components/ManPage'
import HomePage from './components/HomePage'
import SportPage from './components/SportPage'
import ComputerPage from './components/ComputerPage'
import Mine from './Mine'
import Shop from './Shop';


@Entry
@Component
struct MainPage {
  @State currentIndex: number = CommonConstants.HOME_TAB_INDEX;
  @State changeValue: string = ''
  @State submitValue: string = ''
  private tabController: TabsController = new TabsController()
  @State enableFlag : boolean = true;
  searchController: SearchController = new SearchController()

  /*搜索框*/
  @Builder SearchUI(){
    Row(){
      Search({ value: this.changeValue, placeholder: 'search...', controller: this.searchController })
        .searchButton('搜索')
        .width(CommonConstants.FULL_PARENT)
        .height(30)
        .backgroundColor('#F5F5F5')
        .placeholderColor(Color.Grey)
        .placeholderFont({ size: 14, weight: 400 })
        .textFont({ size: 14, weight: 400 })
        .onSubmit((value: string) => {
          this.submitValue = value
        })
        .onChange((value: string) => {
          this.changeValue = value
        })
    }.padding({ top: $r('app.float.home_grid_margin'), left: $r('app.float.home_list_padding') })
  }
  /*底部Tab构造器*/
  @Builder TabBuilder(title: string, index: number, selectedImg: Resource, normalImg: Resource) {
    Column() {
      Image(this.currentIndex === index ? selectedImg : normalImg)
        .width($r('app.float.mainPage_baseTab_size'))
        .height($r('app.float.mainPage_baseTab_size'))
      Text(title)
        .margin({ top: $r('app.float.mainPage_baseTab_top') })
        .fontSize($r('app.float.main_tab_fontSize'))
        .fontColor(this.currentIndex === index ? $r('app.color.tab_selected') : $r('app.color.tab_unselected'))
    }
    .justifyContent(FlexAlign.Center)
    .height($r('app.float.mainPage_barHeight'))
    .width(CommonConstants.FULL_PARENT)
    .onClick(() => {
      this.currentIndex = index;
      this.tabController.changeIndex(this.currentIndex);
    })
  }

  resetVisibleAndLength(index : number){
    if (index === 0) {
      this.enableFlag = true;
    } else {
      this.enableFlag = false;
    }
  }


  build() {
    Column() {
      /*搜索框*/
      Row(){
        Search({ value: this.changeValue, placeholder: '男士羽绒服', controller: this.searchController })
          .searchButton('搜索')
          .width(CommonConstants.FULL_PARENT)
          .height(30)
          .backgroundColor('#F5F5F5')
          .placeholderColor(Color.Grey)
          .placeholderFont({ size: 14, weight: 400 })
          .textFont({ size: 14, weight: 400 })
          .onSubmit((value: string) => {
            this.submitValue = value
          })
          .onChange((value: string) => {
            this.changeValue = value
          })
      }.padding({ top: $r('app.float.home_grid_margin'), left: $r('app.float.home_list_padding') })
      .visibility(this.enableFlag ? Visibility.Visible : Visibility.None)


      /*顶部Tab*/
      Column() {
        Tabs({ barPosition: BarPosition.Start }) {
          /*推荐页*/
          TabContent() {HomePage()}.tabBar(CommonConstants.HOME_TITLE)
          /*女装页*/
          TabContent() {WomanPage()}.tabBar(CommonConstants.WOMAN_TITLE)
          /*男装页*/
          TabContent() {ManPage()}.tabBar(CommonConstants.MAN_TITLE)
          /*运动页*/
          TabContent() {SportPage()}.tabBar(CommonConstants.SPORT_TITLE)
          /*电脑办公页*/
          TabContent() {ComputerPage()}.tabBar(CommonConstants.TEC_TITLE)
          /*其他*/
          TabContent() {}.tabBar(CommonConstants.OTHER_TITLE)
        }.barHeight('35vp')
        .vertical(false).scrollable(true).barMode(BarMode.Scrollable)
        .onChange((index: number) => {
          console.info(index.toString())
        }).width('100%').backgroundColor(0xF1F3F5)
      }.width('100%')
      .height('87%')
      .visibility(this.enableFlag ? Visibility.Visible : Visibility.None)

      /*底部Tab*/
      Column() {
        Tabs({ barPosition: BarPosition.End, controller : this.tabController}) {
          /*首页*/
          TabContent() {
            HomePage()
          }
          .padding({ left: $r('app.float.mainPage_padding'), right: $r('app.float.mainPage_padding') })
          .backgroundColor($r('app.color.mainPage_backgroundColor'))
          .tabBar(this.TabBuilder(CommonConstants.HOME_TITLE, CommonConstants.HOME_TAB_INDEX, $r('app.media.home_selected'), $r('app.media.home_normal')))
          /*购物车*/
          TabContent() {
            Shop()
          }
          .padding({ left: $r('app.float.mainPage_padding'), right: $r('app.float.mainPage_padding') })
          .tabBar(this.TabBuilder(CommonConstants.SHOP_TITLE, CommonConstants.SHOP_TAB_INDEX, $r('app.media.shopping_selected'), $r('app.media.shopping_normal')))
          /*个人中心*/
          TabContent() {
            Mine()
          }.padding({ left: $r('app.float.mainPage_padding'), right: $r('app.float.mainPage_padding') })
          .tabBar(this.TabBuilder(CommonConstants.USER_TITLE, CommonConstants.USER_TAB_INDEX, $r('app.media.mine_selected'), $r('app.media.mine_normal')))
        }
        .vertical(false)
        .scrollable(true)
        .barMode(BarMode.Fixed)
        .onChange((index: number) => {
          console.debug('index number: '+index.toString())
          this.resetVisibleAndLength(index)
        }).width('100%')
        .backgroundColor(0xF1F3F5)
      }
      .width('100%')
      .height(this.enableFlag ? '50vp' : '100%')
      /*-----------------------------end------------------------------------*/
    }.width('100%')
    .height(CommonConstants.FULL_PARENT)
  }

}

@Component
struct TopTabDisplay{
  enableFlag : boolean = null;

  build(){
    Column() {
      Tabs({ barPosition: BarPosition.Start }) {
        /*推荐页*/
        TabContent() {
          HomePage()
        }.tabBar(CommonConstants.HOME_TITLE)
        /*女装页*/
        TabContent() {
          WomanPage()
        }
        .tabBar(CommonConstants.WOMAN_TITLE)
        /*男装页*/
        TabContent() {
          ManPage()
        }
        .tabBar(CommonConstants.MAN_TITLE)
        /*运动页*/
        TabContent() {
          SportPage()
        }
        .tabBar(CommonConstants.SPORT_TITLE)
        /*电脑办公页*/
        TabContent() {
          ComputerPage()
        }
        .tabBar(CommonConstants.TEC_TITLE)
        /*其他*/
        TabContent() {

        }
        .tabBar(CommonConstants.OTHER_TITLE)
      }
      .vertical(false)
      .scrollable(true)
      .barMode(BarMode.Scrollable)
      .onChange((index: number) => {
        console.info(index.toString())
      })
      .width('100%')
      .backgroundColor(0xF1F3F5)
    }
    .width('100%')
    .height('85%')
    .visibility(this.enableFlag ? Visibility.Visible : Visibility.None)
  }
}



@Component
struct BottomTabContentDisplay{
  build(){

  }
}
