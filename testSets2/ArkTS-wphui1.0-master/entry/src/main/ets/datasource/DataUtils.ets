
import router from '@ohos.router'
import { CardInfo,ProperColorData, SimpleCardInfo} from '../viewmodel/DataModels'
import { mockCardInfo, mockProperColorData, mockProperSizeData, mockShopCardInfo, mockSportCardInfo, mockTecCardInfo } from './MockData'

const DEBUG_PREVIEW = false

export function getCardInfo(cardId : string): CardInfo {
  console.log("getCardInfo:"+cardId);
  return mockCardInfo.find(cardData => cardData.cardId === cardId);
}

export function getProperColorData(): Array<ProperColorData> {
  return mockProperColorData;
}

export function getProperSizeData(): Array<number> {
  return mockProperSizeData;
}

export function getSportCardInfo(): Array<SimpleCardInfo> {
  return mockSportCardInfo;
}

export function getTecCardInfo(): Array<SimpleCardInfo> {
  return mockTecCardInfo;
}

export function getShopCardInfo(): Array<CardInfo> {
  return mockShopCardInfo;
}