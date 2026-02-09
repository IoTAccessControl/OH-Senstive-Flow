
import CommonConstants from '../../constants/CommonConstants'
import Demo01 from './Demo01'
import Demo03 from './Demo03';
@Entry
@Component
struct Demo02 {
  private searchController: SearchController = new SearchController();
  @State changeValue: string = '';
  @State submitValue: string = '';

  build(){
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

      Tabs({ barPosition: BarPosition.Start }) {
        /*推荐页*/
        TabContent() {
          Demo03()
        }.tabBar(CommonConstants.WOMAN_TITLE)
        /*Tab1*/
        TabContent() {
          Demo01()
        }.tabBar(CommonConstants.HOME_TITLE)
        /*Tab2*/
        TabContent() {
          Text('Tab2')
        }.tabBar(CommonConstants.MAN_TITLE)
        /*Tab3*/
        TabContent() {
          Text('Tab3')
        }.tabBar(CommonConstants.SPORT_TITLE)
        /*Tab4*/
        TabContent() {
          Text('Tab4')
        }.tabBar(CommonConstants.TEC_TITLE)
        /*其他*/
        TabContent() {

        }.tabBar(CommonConstants.OTHER_TITLE)
      }.barHeight('35vp')
      .vertical(false)
      .scrollable(true)
      .barMode(BarMode.Scrollable)
      .onChange((index: number) => {
        console.info(index.toString())
      }).width('100%').backgroundColor(0xF1F3F5)
    }.width('100%')
    .height('100%')
  }
}