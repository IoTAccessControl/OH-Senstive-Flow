# OH哔哩

### 项目简介
【OH哔哩】是一款基于OpenHarmony系统ArkUI框架开发的哔哩哔哩动画第三方客户端。

### 工程目录
```shell
├── README.md
├── AppScope
├── entry
│   ├── ets
│   │   ├── model     数据模型          
│   │   ├── network   网络请求
│   │   ├── pages     ui界面
│   │   ├── player    播放器封装
│   │   ├── utils     工具集
│   │   ├── view      视图组件
│   │   └── workers   异步线程  
│   ├── configuration
│   └── resources
└── lib   
    ├── DanmakuFlameMaster.har  弹幕支持库
    ├── ijkplayer.har           视频播放器
    ├── imageknife.har          图片缓存库
    ├── PullToRefresh.har       下拉刷新库
    ├── retrofit.har            网络请求库
    └── xlog.har                日志框架库
```

- `AppScope` 应用配置
- `ets` 模块代码
- `configuration` 模块配置
- `resources` 模块资源
- `lib` 三方库

### 项目演进
```shell
├── v0.1.0 实现基本视频播放功能
│   └── v0.1.x bug修复及性能优化
├── v0.2.0 实现用户登录及相关功能
│   └── v0.2.x bug修复及性能优化
├── v0.3.0 实现番剧及追番等相关功能
│   └── v0.3.x bug修复及性能优化
├── v0.x.0 继续完善相关功能
└── v1.0.0 发布正式版本
```

### 版本发布
在[版本发布](https://gitee.com/wathinst/ohbili/releases/tag/v0.1.0)获取应用下载链接；

### 更新日志
在[更新日志](./CHANGE.md)查看详细更新信息；

### 约束
- 开发环境
    - **DevEco Studio**: 版本号大于3.1 Beta2，下载安装OpenHarmony SDK API Version 9。（初始的IDE配置可以参考IDE的使用文档）
- 语言版本
    - eTS
- 支持版本
    - 不低于OpenHarmony3.2 Release；
    - 不低于HarmonyOs4.0.0 Developer Beta1；

### 问题反馈
> 注意：提交issue尽量要把问题描述清楚
1. 进入应用`我的`-`反馈`，开启Debug日志；
2. 重启应用，重复异常操作流程；
3. 进入应用`我的`-`反馈`，导出Debug日志；
4. 打开项目gitee网页，提交相关issue；



### 版权声明
【OH哔哩】是一款基于OpenHarmony系统ArkUI框架开发的哔哩哔哩动画第三方客户端，资源版权归属于原作者，请不要用于商业用途，否则一切后果自负。

### 特别鸣谢
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) 哔哩哔哩-API收集整理
- [ohos_ijkplayer](https://gitee.com/openharmony-sig/ohos_ijkplayer) 基于FFmpeg的视频播放器
- [PullToRefresh](https://gitee.com/openharmony-sig/PullToRefresh) 下拉刷新、上拉加载组件
- [axios](https://gitee.com/openharmony-sig/axios) 基于promise 的网络请求库
- [protobuf](https://gitee.com/openharmony-tpc/protobuf) proto格式解析库
- [DanmakuFlameMaster](https://gitee.com/hihopeorg/DanmakuFlameMaster) 弹幕框架库
- [xlog](https://gitee.com/ohos_port/xlog) 日志框架库
- [ImageKnife](https://gitee.com/openharmony-tpc/ImageKnife) 图像加载缓存库

### 捐助
捐赠并不是必须的，不捐赠并不影响该App的正常使用。作为非盈利的开源项目，一杯咖啡就是对我们最好的支持。

<p>
<img src="https://foruda.gitee.com/images/1690168402888028053/a57f74b0_4854455.jpeg" width="25%" >
<img src="https://foruda.gitee.com/images/1690168446655616407/1e620b2d_4854455.jpeg" width="25%" style="margin-left: 30px;">
</p>