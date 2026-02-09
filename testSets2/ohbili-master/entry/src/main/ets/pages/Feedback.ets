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

import { OhNavBar } from '../view/base/OhNavBar'
import fs from '@ohos.file.fs';
import router from '@ohos.router';
import { StringUtil } from '../utils/StringUtil';
import GistClient from '../network/GistClient';
import { ApiConstants } from '../network/ApiConstants';
import Base64 from './../network/Base64';
import { GistData } from '../network/GistTypes';

interface GistPostData {
  content: string;
  message: string;
}

let owner = "ohos_port";
let repo = "log";

@Entry
@Component
struct Feedback {
  @State logArr: LogFile[] = []
  @StorageLink('appLogDebug') appLogDebug: string = '0';
  @StorageLink('appUuid') appUuid: string = 'undefined';
  gistClient = new GistClient(ApiConstants.GITEE_TOKEN);

  aboutToAppear() {
  }

  getLogFiles() {
    fs.listFile(`${globalThis.filesDir}/log`).then((files: string[]) => {
      files.forEach((file: string) => {
        let path = `${globalThis.filesDir}/log/${file}`;
        let size = fs.statSync(path).size;
        this.logArr.push(new LogFile(file, path, size));
      });
    });
  }

  async updateFile(content: string): Promise<boolean> {
    try {
      let date = StringUtil.dateFormat(new Date(), "yyyyMMdd");
      let logName = StringUtil.dateFormat(new Date(), "HHmmss.fff");
      let base64 = new Base64();
      let base64Str = base64.encode(content);
      let postData: GistPostData = {
        content: base64Str,
        message: `update file ${logName}.txt \n by uuid: ${this.appUuid}`,
      };
      let response = await this.gistClient.post<GistData>(`v5/repos/${owner}/${repo}/contents/${date}d/${this.appUuid}/${logName}.txt`, postData);
      return true;
    } catch (err) {
      console.error("OhBili err: " + err);
    }
    return false;
  }

  build() {
    Column() {
      OhNavBar({ title: '反馈' })
      Scroll() {
        Column() {
          Text("为了能更快的定位问题，我们需要您完成以下操作：\n\n")
            .fontSize(16)
            .fontColor("#333333")
            .padding({ top: 16, left: 16, right: 16 })
          Text("1. 开启Debug日志；\n\n" +
          "2. 重启应用，重复异常操作流程；\n\n" +
          "3. 导出Debug日志；\n\n" +
          "4. 打开项目gitee网页，提交相关issue；")
            .width('100%')
            .fontSize(16)
            .fontColor("#333333")
            .padding(16)
          Row() {
            Button(this.appLogDebug == '1' ? "关闭Debug日志" : "开启Debug日志")
              .onClick(() => {
                if (this.appLogDebug == '1') {
                  this.appLogDebug = '0';
                } else {
                  this.appLogDebug = '1';
                }
              })
            Button("查看Debug日志")
              .margin({ left: 20 })
              .onClick(() => {
                this.getLogFiles();
              })
          }.width('100%').justifyContent(FlexAlign.Center)
          .margin({ top: 36, bottom: 36 })
          ForEach(this.logArr, (item: LogFile) => {
            Row() {
              Text(item.name)
              Blank()
              Text(StringUtil.generateSizeStr(item.size))
            }.padding(20).width('100%').onClick(() => {
              router.pushUrl({ url: "pages/LogDetail",
                params: { logFilePath: item.path }
              });
              /*let logStr = fs.readTextSync(item.path);
              this.updateFile(logStr);*/
            })
          }, (item: LogFile) => item.name)
        }
      }.layoutWeight(1)
      .align(Alignment.Top)
      .edgeEffect(EdgeEffect.Fade)
    }.width('100%').height('100%')
  }
}

class LogFile {
  name: string;
  path: string;
  size: number;

  constructor(name: string, path: string, size: number) {
    this.name = name;
    this.path = path;
    this.size = size;
  }
}