import { BusinessError } from '@kit.BasicServicesKit';
import { osAccount } from '@kit.BasicServicesKit';
import { router } from '@kit.ArkUI';
import { appAccount } from '@kit.BasicServicesKit';

import { distributedAccount } from '@kit.BasicServicesKit';

@Entry
@Component
struct AccountInfo {
  @State result: string = '';
  // 获取操作系统账户信息并输出到log
  getAccountInfo() {
    let accountManager: osAccount.AccountManager = osAccount.getAccountManager();

    try {
      //系统账号ID
      accountManager.getOsAccountLocalId((err: BusinessError, localId: number) => {
        if (err) {
          this.result='获取当前进程所属的系统账号ID失败: ' + JSON.stringify(err)
          console.error('获取当前进程所属的系统账号ID失败: ' + JSON.stringify(err));
        } else {
          this.result='成功获取当前进程所属的系统账号ID, localId: ' + localId
          console.log('成功获取当前进程所属的系统账号ID, localId: ' + localId);
        }
      });
    } catch (err) {
      this.result='getOsAccountLocalId exception: ' + JSON.stringify(err)
      console.error('getOsAccountLocalId exception: ' + JSON.stringify(err));
    }

      //创建应用账号
    let appAccountManager: appAccount.AppAccountManager = appAccount.createAppAccountManager();
    try {
      appAccountManager.createAccount('Zhou Jun jie', (err: BusinessError) => {
        this.result=this.result+'\n'+'createAccount err: ' + JSON.stringify(err)
        console.log('createAccount err: ' + JSON.stringify(err));
      });
    } catch (err) {
      this.result=this.result+'\n'+'createAccount err: ' + JSON.stringify(err)
      console.log('createAccount err: ' + JSON.stringify(err));
    }
    //获取所有应用账号
    try {
      appAccountManager.getAllAccounts((err: BusinessError, data: appAccount.AppAccountInfo[]) => {
        if (err) {
          this.result=this.result+"\n"+'getAllAccounts failed, error: ' + JSON.stringify(err)
          console.debug('getAllAccounts failed, error: ' + JSON.stringify(err));
        } else {
          this.result=this.result+"\n"+'getAllAccounts successfully'+JSON.stringify(data)
          console.info('getAllAccounts successfully'+JSON.stringify(data));
        }
      });
    } catch (err) {

      this.result=this.result+"\n"+'getAllAccounts exception: ' + JSON.stringify(err)
      console.debug('getAllAccounts exception: ' + JSON.stringify(err));
    }
    //权限不够
    const accountAbility: distributedAccount.DistributedAccountAbility = distributedAccount.getDistributedAccountAbility();
    try {
      accountAbility.getOsAccountDistributedInfo(
        (err: BusinessError, data: distributedAccount.DistributedInfo) => {
          if (err) {
            this.result+='\n'+'getOsAccountDistributedInfo exception: ' + JSON.stringify(err)
            console.log('getOsAccountDistributedInfo exception: ' + JSON.stringify(err));
          } else {
            this.result+='\n'+'distributed information: ' + JSON.stringify(data)
            console.log('distributed information: ' + JSON.stringify(data));
          }
        });
    } catch (err) {
      this.result+='\n'+'getOsAccountDistributedInfo exception1: ' + JSON.stringify(err)
      console.log('getOsAccountDistributedInfo exception: ' + JSON.stringify(err));
    }

  }

  // build方法，组件加载时调用获取账户信息方法
  build() {
    Column() {
      Text("获取账户信息")
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .margin({ bottom: 20 });

      Button("获取账户信息")
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .backgroundColor("#57be6a")
        .width('100%')
        .height(45)
        .borderRadius(5)
        .onClick(() => {
          this.getAccountInfo();  // 点击按钮后获取账户信息
        })

      Button('返回主页面')
        .onClick(() => router.back())  // 点击按钮返回主页面
        .width('100%')
        .height(40)
        .margin({ bottom: 16 })

      Text(this.result)
        .width(220)
        .height(50)
        .margin({ bottom: 40 });

    }
    .width('100%')
    .height('100%')
    .padding({
      left: 24,
      right: 24
    })
  }
}
