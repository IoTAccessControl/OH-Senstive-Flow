/**
 * Copyright (c) 2023 Wathinst <wxz@xkzhineng.com>
 * OhBili is licensed under Mulan PSL v2.
 * You can use this software according to the terms and conditions of the Mulan PSL v2.
 * You may obtain a copy of Mulan PSL v2 at:
 * http://license.coscl.org.cn/MulanPSL2
 * THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND,
 * EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT,
 * MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
 * See the Mulan PSL v2 for more details.
 */

import router from '@ohos.router';
import { SearchBar } from '../view/home/SearchBar';
import { SearchVideo, SearchVideoToBaseVideo } from '../model/response/SearchResponse';
import { BaseVideo } from '../model/response/Response';
import { HomePullToRefresh } from '../view/home/HomePullToRefresh';
import { DataSourceManager } from '../model/DataSourceManager';
import { PopularItemView } from '../view/home/PopularItem';
import { ApiManager } from '../network/ApiManager';
import { BLog } from '../utils/BLog';

interface SearchResultParams {
  keyword?: string;
}

@Entry
@Component
struct SearchResultPage {
  @State data: SearchVideo[] = [];
  private keyword: string = '';
  private scroller: Scroller = new Scroller();
  @State pn: number = 1;
  @State isLoading: boolean = false;

  aboutToAppear() {
    const params = router.getParams() as SearchResultParams;
    if (params && params.keyword) {
      this.keyword = params.keyword;
    }
    BLog.i("SearchResultPage keyword:" + this.keyword);
    this.isLoading = true;
    ApiManager.getInstance().requestSearch(this.keyword, this.pn).then((result: boolean) => {
      this.isLoading = false;
    })
  }

  aboutToDisappear() {
    DataSourceManager.getSearchSource().setData([]);
  }

  build() {
    Column() {
      SearchBar({keyword: this.keyword})

      if (this.isLoading) {
        Text('数据加载中···')
          .width('100%').layoutWeight(1)
          .fontSize(14).textAlign(TextAlign.Center)
      } else {
        HomePullToRefresh({
          // 必传项，列表组件所绑定的数据
          data: $data,
          // 必传项，需绑定传入主体布局内的列表或宫格组件
          scroller: this.scroller,
          // 必传项，自定义主体布局，内部有列表或宫格组件
          customList: this.getListView,
          // 可选项，下拉刷新回调
          onRefresh: () => {
            return new Promise<string>((resolve, reject) => {
              this.pn = 1;
              ApiManager.getInstance().requestSearch(this.keyword, this.pn).then((success: boolean) => {
                resolve('');
              });
            });
          },
          // 可选项，上拉加载更多回调
          onLoadMore: () => {
            return new Promise<string>((resolve, reject) => {
              this.pn++;
              ApiManager.getInstance().requestSearch(this.keyword, this.pn).then((success: boolean) => {
                resolve('');
              });
            });
          },
          customLoad: undefined,
          customRefresh: undefined,
        }).layoutWeight(1)
      }
    }
  }

  @Builder
  private getListView(onItemClick: (item: BaseVideo, index: number) => void, onListStatus: (isListStart: boolean, isListEnd: boolean) => void) {
    List({ scroller: this.scroller }) {
      LazyForEach(DataSourceManager.getSearchSource(), (item: SearchVideo, index: number) => {
        ListItem() {
          PopularItemView({ item: SearchVideoToBaseVideo(item) })
        }
      }, (item: SearchVideo) => item.bvid)
    }
    .backgroundColor('#ffffff')
    .width('100%')
    .padding({ left: 16, right: 16 })
    .divider({ strokeWidth: 1, color: '#ffeeeeee' })
    .edgeEffect(EdgeEffect.None)
    .onScrollIndex((start, end) => {
      onListStatus(start == 0, end == DataSourceManager.getSearchSource().totalCount() - 1)
    })
  }

}