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

import protobuf from '@ohos/protobufjs'
import { PlayUrlResponse } from '../model/response/PlayUrlResponse';
import { ProtoSource } from '../model/proto/ProtoSource'
import { RankingResponse } from '../model/response/RankingResponse';
import { VideoPartsResponse } from '../model/response/VideoPartsResponse';
import { DataSourceManager } from '../model/DataSourceManager';
import { TaskManager } from './TaskManager';
import { BLog } from '../utils/BLog';
import { ReplyCursor } from '../model/response/ReplyResponse';
import { ReplyPage } from '../model/response/ReplyDetailResponse';
import { ArchiveStatResponse } from '../model/response/ArchiveStatResponse';
import { CardInfoResponse } from '../model/response/UserCardInfoResponse';

import { bilibili } from '../model/proto/danmaku'

export class ApiManager {
  private constructor() {
    DataSourceManager.initData();
  }
  private static instance: ApiManager;

  public static getInstance(): ApiManager {
    if (!ApiManager.instance) {
      ApiManager.instance = new ApiManager();
    }
    return ApiManager.instance;
  }

  async requestRelated(bvid: string): Promise<boolean> {
    BLog.d(`requestRelated bvid: ${bvid}`);
    let response = await TaskManager.getInstance().requestRelated(bvid);
    if (response.code == -1 ) {
      BLog.e("requestRelated err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestRelated result: " + JSON.stringify(response.result));
      DataSourceManager.getRelatedSource(bvid).addAllData(response.result.data);
    }
    return response.code != -1;
  }

  async requestRecommend(freshIdx: number, isFresh: boolean): Promise<boolean> {
    BLog.d(`requestRecommend freshIdx: ${freshIdx}, isFresh: ${isFresh}`);
    let response = await TaskManager.getInstance().requestRecommend(freshIdx);
    if (response.code == -1 ) {
      BLog.e("requestRecommend err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestRecommend result: " + JSON.stringify(response.result));
      if (isFresh) {
        DataSourceManager.getRecommendSource().setData(response.result.data.item);
      } else {
        DataSourceManager.getRecommendSource().addAllData(response.result.data.item);
      }
    }
    return response.code != -1;
  }

  async requestPopular(pn: number): Promise<boolean> {
    BLog.d(`requestPopular pn: ${pn}`);
    let response = await TaskManager.getInstance().requestPopular(pn);
    if (response.code == -1 ) {
      BLog.e("requestPopular err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestPopular result: " + JSON.stringify(response.result));
      if (pn == 1) {
        DataSourceManager.getPopularSource().setData(response.result.data.list);
      } else {
        DataSourceManager.getPopularSource().addAllData(response.result.data.list);
      }
    }
    return response.code != -1;
  }

  async requestPlayUrl(bvid: string, cid: number): Promise<PlayUrlResponse> {
    BLog.d(`requestPlayUrl bvid: ${bvid}, cid: ${cid}`);
    let response = await TaskManager.getInstance().requestPlayUrl(bvid, cid);
    if (response.code == -1 ) {
      BLog.e("requestPlayUrl err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestPlayUrl result: " + JSON.stringify(response.result));
    }
    return response.result
  }

  async requestReply(oid: string, next: number,
                      type: number, sort: number): Promise<ReplyCursor> {
    BLog.d(`requestReply oid: ${oid}, next: ${next}, type: ${type}, sort: ${sort}`);
    let response = await TaskManager.getInstance().requestReply(oid, 12, next, type, sort);
    if (response.code == -1 ) {
      BLog.e("requestReply err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestReply result: " + JSON.stringify(response.result));
      if (next == 0) {
        DataSourceManager.getReplySource(oid).setData(response.result.data.replies ?? []);
      } else {
        DataSourceManager.getReplySource(oid).addAllData(response.result.data.replies ?? []);
      }
      return response.result.data.cursor;
    }
    return {
        is_begin: true,
        prev: 0,
        next: 0,
        is_end: true,
        mode: 0,
        mode_text: '',
        all_count: 0
    };
  }

  async requestReplyDetail(oid: string, root: number, pn: number,
                      type: number): Promise<ReplyPage> {
    BLog.d(`requestReplyDetail oid: ${oid}, root: ${root}, pn: ${pn}, type: ${type}`);
    let response = await TaskManager.getInstance().requestReplyDetail(oid, root, 12, pn, type);
    if (response.code == -1 ) {
      BLog.e("requestReplyDetail err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestReplyDetail result: " + JSON.stringify(response.result));
      DataSourceManager.getReplyDetailSource().addAllData(response.result.data.replies ?? []);
      return response.result.data.page;
    }
    return { num: 0, size: 0, count: 0 };
  }

  async requestDmList(oid: number, type: number, index: number): Promise<ProtoSource> {
    BLog.d(`requestDmList oid: ${oid}, type: ${type}, index: ${index}`);
    let response = await TaskManager.getInstance().requestDmList(oid, type, index);
    if (response.code == -1 ) {
      BLog.e("requestDmList err=" + response.message);
    }
    BLog.i('requestDmList Result byteLength:' + response.result.byteLength);
    // let builder = await protobuf.loadProtoFile('danmaku.proto', null, null, globalThis.resourceMana);
    // // @ts-ignore
    // let DmSegMobileReply = builder.build("bilibili.community.service.dm.v1.DmSegMobileReply");
    // let reply = DmSegMobileReply.decode(response.result);
    let reply = bilibili.community.service.dm.v1.DmSegMobileReply.decode(response.result);
    BLog.i('requestDmList Result elems length:' + reply.elems.length);
    return new ProtoSource(reply);
  }

  async requestRanking(): Promise<RankingResponse> {
    BLog.d(`requestRanking`);
    let response = await TaskManager.getInstance().requestRanking();
    if (response.code == -1 ) {
      BLog.e("requestRanking err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestRanking result: " + JSON.stringify(response.result));
    }
    return response.result;
  }

  async requestSearch(keyword: string, pn: number): Promise<boolean> {
    BLog.d(`requestSearch keyword: ${keyword}, pn: ${pn}`);
    let encoded = encodeURIComponent(keyword);
    let cookies = 'b_ut=7;i-wanna-go-back=-1;b_nut=1689340641;buvid3=D1834A0C-8619-E71F-A594-05F6B806551041895infoc;innersign=0';
    let response = await TaskManager.getInstance().requestSearch(cookies, "video", encoded, pn);
    if (response.code == -1 ) {
      BLog.e("requestSearch err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestSearch result: " + JSON.stringify(response.result));
      if (pn == 1) {
        DataSourceManager.getSearchSource().setData(response.result.data.result);
      } else {
        DataSourceManager.getSearchSource().addAllData(response.result.data.result);
      }
    }
    return response != null;
  }

  async requestPageList(bvid: string): Promise<VideoPartsResponse> {
    BLog.d(`requestPageList bvid: ${bvid}`);
    let response = await TaskManager.getInstance().requestPageList(bvid);
    if (response.code == -1 ) {
      BLog.e("requestPageList err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestPageList result: " + JSON.stringify(response.result));
    }
    return response.result;
  }

  async requestSearchDefault(): Promise<string> {
    BLog.d("requestSearchDefault");
    let response = await TaskManager.getInstance().requestSearchDefault();
    if (response.code == -1 ) {
      BLog.e("requestSearchDefault err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestSearchDefault result: " + JSON.stringify(response.result));
      return response.result.data.name;
    }
    return "OpenHarmony";
  }

  async requestArchiveStat(bvid: string): Promise<ArchiveStatResponse> {
    BLog.d(`requestArchiveStat bvid: ${bvid}`);
    let response = await TaskManager.getInstance().requestArchiveStat(bvid);
    if (response.code == -1 ) {
      BLog.e("requestArchiveStat err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestArchiveStat result: " + JSON.stringify(response.result));
    }
    return response.result;
  }

  async requestArchiveDesc(bvid: string): Promise<string> {
    BLog.d(`requestArchiveDesc bvid: ${bvid}`);
    let response = await TaskManager.getInstance().requestArchiveDesc(bvid);
    if (response.code == -1 ) {
      BLog.e("requestArchiveDesc err=" + response.message);
    }
    if (response.result != null) {
      BLog.d("requestArchiveDesc result: " + JSON.stringify(response.result));
      return response.result.data;
    }
    return "";
  }

  async requestUserCardInfo(mid: number, photo: boolean = false): Promise<CardInfoResponse> {
    BLog.d("requestUserCardInfo");
    let response = await TaskManager.getInstance().requestUserCardInfo(mid, photo);
    if(response.code == -1) {
      BLog.e("requestUserCardInfo err=" + response.message);
    }
    if(response.result !== null) {
      BLog.d("requestUserCardInfo result:" + JSON.stringify(response.result));
    }
    return response.result as CardInfoResponse;
  }
}