import { mockCardInfo } from '../datasource/MockData';
import ItemData from './ItemData';
export class MainViewModel{

  getMainPagesSwiperImages(): Array<Resource> {
    let swiperImages: Resource[] = [
    $r('app.media.sw1'),
    $r('app.media.sw2'),
    // $r('app.media.sw3')
    ];
    return swiperImages;
  }

  getWomanPagesSwiperImages(): Array<Resource> {
    let swiperImages: Resource[] = [
    $r('app.media.sw1'),
    $r('app.media.sw2'),
    ];
    return swiperImages;
  }

  getManPagesSwiperImages(): Array<Resource> {
    let swiperImages: Resource[] = [
    $r('app.media.sw1'),
    $r('app.media.sw2'),
    $r('app.media.sw3')
    ];
    return swiperImages;
  }

  getFirstGridData(): Array<ItemData> {
    let firstGridData: ItemData[] = [
      new ItemData($r('app.string.mainPage_brand'), $r('app.media.grid1'), $r('app.string.mainPage_text_brand')),
      new ItemData($r('app.string.mainPage_found'), $r('app.media.grid2'), $r('app.string.mainPage_text_found'))
    ];
    return firstGridData;
  }

  getSecondGridData(): Array<ItemData> {
    let secondGridData: ItemData[] = [
      new ItemData($r('app.string.row1_money'), $r('app.media.row1'), $r('app.string.mainPage_text_brand')),
      new ItemData($r('app.string.row2_money'), $r('app.media.row2'), $r('app.string.mainPage_text_brand')),
      new ItemData($r('app.string.row3_money'), $r('app.media.row3'), $r('app.string.mainPage_text_brand')),
      new ItemData($r('app.string.row4_money'), $r('app.media.row4'), $r('app.string.mainPage_text_brand'))
    ];
    return secondGridData;
  }

  getListCardData(): Array<ItemData> {
    let listCardData: ItemData[] = [
      new ItemData($r('app.string.row1_money'), $r('app.media.card'), $r('app.string.mainPage_text_brand')),
      new ItemData($r('app.string.row2_money'), $r('app.media.card'), $r('app.string.mainPage_text_brand')),
      new ItemData($r('app.string.row3_money'), $r('app.media.card'), $r('app.string.mainPage_text_brand')),
      new ItemData($r('app.string.row4_money'), $r('app.media.card'), $r('app.string.mainPage_text_brand'))
    ];
    return listCardData;
  }

  getWomanPageData(index : number): Array<ItemData> {
    let womanPageData: ItemData[] = []
    if (index == 0) {
      womanPageData = [
        new ItemData($r('app.string.woman_short_eiderdown'), $r('app.media.w_shortJacket')),
        new ItemData($r('app.string.woman_undershirt'), $r('app.media.w_undershirt')),
        new ItemData($r('app.string.woman_skirt'), $r('app.media.w_skirt')),
        new ItemData($r('app.string.woman_pants'), $r('app.media.w_pants')),
        new ItemData($r('app.string.woman_jackets'), $r('app.media.w_jackets')),
        new ItemData($r('app.string.woman_hoodies'), $r('app.media.w_hoodies')),
        new ItemData($r('app.string.woman_fur'), $r('app.media.w_fur')),
        new ItemData($r('app.string.woman_long_eiderdown'), $r('app.media.w_eiderdown')),
        new ItemData($r('app.string.woman_coat'), $r('app.media.w_coat')),
        new ItemData($r('app.string.woman_cardigan'), $r('app.media.w_cardigan')),
      ];
    } else if (index == 1) {
      womanPageData = [
        new ItemData($r('app.string.woman_short_eiderdown'), $r('app.media.w_shortJacket')),
        new ItemData($r('app.string.woman_undershirt'), $r('app.media.w_undershirt')),
        new ItemData($r('app.string.woman_skirt'), $r('app.media.w_skirt')),
        new ItemData($r('app.string.woman_cardigan'), $r('app.media.w_cardigan')),
      ];
    } else if (index == 2){
      womanPageData = [
        new ItemData($r('app.string.woman_hoodies'), $r('app.media.w_hoodies')),
        new ItemData($r('app.string.woman_fur'), $r('app.media.w_fur')),
        new ItemData($r('app.string.woman_long_eiderdown'), $r('app.media.w_eiderdown')),
        new ItemData($r('app.string.woman_coat'), $r('app.media.w_coat')),
        new ItemData($r('app.string.woman_cardigan'), $r('app.media.w_cardigan'))
      ];
    } else {
      womanPageData = [
        new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand1')),
        new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand2')),
        new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand3')),
        new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand4')),
        new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand5')),
        new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand6')),
        new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand7')),
        new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand8'))
      ];
    }

    return womanPageData;
  }

  getWomanTopCategoryData(): Array<ItemData> {
    let womanCategoryData: ItemData[] = [
      new ItemData($r('app.string.woman_short_eiderdown'), $r('app.media.w_shortJacket')),
      new ItemData($r('app.string.woman_undershirt'), $r('app.media.w_undershirt')),
      new ItemData($r('app.string.woman_skirt'), $r('app.media.w_skirt')),
      new ItemData($r('app.string.woman_cardigan'), $r('app.media.w_cardigan')),
    ];
    return womanCategoryData;
  }

  getWomanUnderCategoryData(): Array<ItemData> {
    let womanCategoryData: ItemData[] = [
      new ItemData($r('app.string.woman_hoodies'), $r('app.media.w_hoodies')),
      new ItemData($r('app.string.woman_fur'), $r('app.media.w_fur')),
      new ItemData($r('app.string.woman_long_eiderdown'), $r('app.media.w_eiderdown')),
      new ItemData($r('app.string.woman_coat'), $r('app.media.w_coat')),
      new ItemData($r('app.string.woman_cardigan'), $r('app.media.w_cardigan'))
    ];
    return womanCategoryData;
  }

  getWomanBrandData(): Array<ItemData> {
    let womanBrandData: ItemData[] = [
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand1')),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand2')),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand3')),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand4')),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand5')),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand6')),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand7')),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.brand8'))
    ];
    return womanBrandData;
  }

  getManWaterData() : Array<ItemData> {
    let manWaterData : ItemData[] = [
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man1'), mockCardInfo[0].cardId, mockCardInfo[0].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man2'), mockCardInfo[1].cardId, mockCardInfo[1].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man3'), mockCardInfo[2].cardId, mockCardInfo[2].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man4'), mockCardInfo[3].cardId, mockCardInfo[3].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man5'), mockCardInfo[4].cardId, mockCardInfo[4].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man6'), mockCardInfo[5].cardId, mockCardInfo[5].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man7'), mockCardInfo[6].cardId, mockCardInfo[6].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man8'), mockCardInfo[7].cardId, mockCardInfo[7].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man9'), mockCardInfo[8].cardId, mockCardInfo[8].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man10'), mockCardInfo[9].cardId, mockCardInfo[9].price),
      new ItemData($r('app.string.woman_text_brand'), $r('app.media.man11'), mockCardInfo[10].cardId, mockCardInfo[10].price)
    ];
    return manWaterData;
  }

/*  getSettingListData(): Array<ItemData> {
    let settingListData: ItemData[] = [
      new ItemData($r('app.string.setting_list_news'), $r('app.media.news'), $r("app.string.setting_toggle")),
      new ItemData($r('app.string.setting_list_data'), $r('app.media.data')),
      new ItemData($r('app.string.setting_list_menu'), $r('app.media.menu')),
      new ItemData($r('app.string.setting_list_about'), $r('app.media.about')),
      new ItemData($r('app.string.setting_list_storage'), $r('app.media.storage')),
      new ItemData($r('app.string.setting_list_privacy'), $r('app.media.privacy'))
    ];
    return settingListData;
  }*/

  getMimeGridData(): Array<ItemData> {
    let firstGridData: ItemData[] = [
      new ItemData($r('app.string.mime_pay'), $r('app.media.pay'), $r('app.string.mainPage_text_brand')),
      new ItemData($r('app.string.mine_car'), $r('app.media.car'), $r('app.string.mainPage_text_found')),
      new ItemData($r('app.string.mime_talk'), $r('app.media.talk'), $r('app.string.mainPage_text_found'))
    ];
    return firstGridData;
  }

  getMimeGridSecondData(): Array<ItemData> {
    let secondGridData: ItemData[] = [
      new ItemData($r('app.string.mine_coupon'), $r('app.media.m_coupon_center')),
      new ItemData($r('app.string.mine_message'), $r('app.media.m_message_center')),
      new ItemData($r('app.string.mine_sub'), $r('app.media.love')),
      new ItemData($r('app.string.mine_shop'), $r('app.media.shopping')),
      new ItemData($r('app.string.mine_vip'), $r('app.media.m_vip_center')),
      new ItemData($r('app.string.mine_account'), $r('app.media.m_account_center')),
      new ItemData($r('app.string.mine_note'), $r('app.media.about'))


    ];
    return secondGridData;
  }


}

export default new MainViewModel();