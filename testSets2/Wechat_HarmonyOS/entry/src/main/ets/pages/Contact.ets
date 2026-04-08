import { contact } from '@kit.ContactsKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import router from '@ohos.router';  // 引入路由模块

@Entry
@Component
struct SelectContact {
  // 选择联系人方法
  chooseContact(): Promise<string> {
    let phone: string = '';
    let name: string = '';
    return new Promise((resolve, reject) => {
      //模拟器设备返回假数据
      if (deviceInfo.productModel === 'emulator') {
        return resolve('13800000000_test');
      }

      // 调用选择联系人API
      contact.selectContacts().then((info: Array<contact.Contact>) => {
        if (info && info.length > 0) {
          const item = info[0];  // 只取第一个联系人信息
          phone = item?.phoneNumbers ? item?.phoneNumbers[0].phoneNumber : '';
          name = item?.name ? item?.name?.fullName : '';
        }
        resolve(phone + '_' + name);  // 返回手机号和姓名
      }).catch((err: object | string) => {
        hilog.error(0xFF00, 'SelectContact', '%{public}s', `selectContact fail: err->${JSON.stringify(err)}`);
        reject(err);
      });
    });
  }

  async testSelectContact() {
    try {
      const contactInfo = await this.chooseContact();
      console.log('选择的联系人信息:', contactInfo);
    } catch (error) {
      console.error('获取联系人失败:', error);
    }
  }


  // 跳转到主页面
  goBack() {
    router.back();  // 返回到主页面
  }

  // 空的 build 方法
  build() {
    Column() {
      Button('返回主页面')
        .onClick(() => this.goBack())  // 点击按钮返回主页面
        .width('100%')
        .height(40)
        .margin({ bottom: 16 })

      Button('获取')
        .onClick(() => this.testSelectContact())  // 点击按钮返回主页面
        .width('100%')
        .height(40)
        .margin({ bottom: 16 })


      // 其他组件（如果需要）
    }
    .width('100%')
    .height('100%')
    .padding({
      left: 24,
      right: 24
    });
  }
}
