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

import { VideoDataSource } from '../model/VideoDataSource';
import { ReplyDataSource } from './ReplyDataSource';
import { SearchDataSource } from './SearchDataSource';

export class DataSourceGlobal {
  private constructor() {}
  private static instance: DataSourceGlobal;

  recommendSource?: VideoDataSource;
  popularSource?: VideoDataSource;
  relatedMapSource?: Map<string, VideoDataSource>;
  replyMapSource?: Map<string, ReplyDataSource>;
  replyDetailSource?: ReplyDataSource;
  searchSource?: SearchDataSource;

  public static getContext(): DataSourceGlobal {
    if (!DataSourceGlobal.instance) {
      DataSourceGlobal.instance = new DataSourceGlobal();
    }
    return DataSourceGlobal.instance;
  }


}

export class DataSourceManager {

  public static initData() {
    DataSourceGlobal.getContext().recommendSource = new VideoDataSource();
    DataSourceGlobal.getContext().popularSource = new VideoDataSource();
    DataSourceGlobal.getContext().relatedMapSource = new Map<string, VideoDataSource>();
    DataSourceGlobal.getContext().replyMapSource = new Map<string, ReplyDataSource>();
    DataSourceGlobal.getContext().replyDetailSource = new ReplyDataSource();
    DataSourceGlobal.getContext().searchSource = new SearchDataSource();
  }

  public static getRecommendSource(): VideoDataSource {
    return DataSourceGlobal.getContext().recommendSource ?? new VideoDataSource();
  }

  public static getPopularSource(): VideoDataSource {
    return DataSourceGlobal.getContext().popularSource ?? new VideoDataSource();
  }

  public static setRelatedMapSource(key: string) {
    DataSourceGlobal.getContext().relatedMapSource?.set(key, new VideoDataSource());
  }

  public static deleteRelatedMapSource(key: string) {
    DataSourceGlobal.getContext().relatedMapSource?.delete(key);
  }

  public static getRelatedSource(key?: string): VideoDataSource {
    if (key != undefined && DataSourceGlobal.getContext().relatedMapSource?.has(key)) {
      return DataSourceGlobal.getContext().relatedMapSource?.get(key) ?? new VideoDataSource();
    }
    return new VideoDataSource();
  }

  public static setReplyMapSource(key: string) {
    DataSourceGlobal.getContext().replyMapSource?.set(key, new ReplyDataSource());
  }

  public static deleteReplyMapSource(key: string) {
    DataSourceGlobal.getContext().replyMapSource?.delete(key);
  }

  public static getReplySource(key?: string): ReplyDataSource {
    if (key != null && DataSourceGlobal.getContext().replyMapSource?.has(key)) {
      return DataSourceGlobal.getContext().replyMapSource?.get(key) ?? new ReplyDataSource();
    }
    return new ReplyDataSource();
  }

  public static getReplyDetailSource(): ReplyDataSource {
    return DataSourceGlobal.getContext().replyDetailSource ?? new ReplyDataSource();
  }

  public static getSearchSource(): SearchDataSource {
    return DataSourceGlobal.getContext().searchSource ?? new SearchDataSource();
  }
}