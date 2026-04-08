import { sensor } from '@kit.SensorServiceKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { router } from '@kit.ArkUI';


@Entry
@Component
struct Index {

  @State result: string = '';
  sensor(){
    try {
      sensor.on(sensor.SensorId.ACCELEROMETER, (data: sensor.AccelerometerResponse) => {
        this.result='Succeeded in invoking on. X-coordinate component: ' + data.x+'\n'+
          'Succeeded in invoking on. Y-coordinate component: ' + data.y+'\n'+
          'Succeeded in invoking on. Z-coordinate component: ' + data.z+'\n'
        console.info('Succeeded in invoking on. X-coordinate component: ' + data.x);
        console.info('Succeeded in invoking on. Y-coordinate component: ' + data.y);
        console.info('Succeeded in invoking on. Z-coordinate component: ' + data.z);
      }, { interval: 10000000 });
      setTimeout(() => {
        sensor.off(sensor.SensorId.ACCELEROMETER);
      }, 500);
    } catch (error) {
      let e: BusinessError = error as BusinessError;
      console.error(`Failed to invoke on. Code: ${e.code}, message: ${e.message}`);
    }

    try {
      sensor.on(sensor.SensorId.ACCELEROMETER_UNCALIBRATED, (data: sensor.AccelerometerUncalibratedResponse) => {
        console.info('Succeeded in invoking on. X-coordinate component: ' + data.x);
        console.info('Succeeded in invoking on. Y-coordinate component: ' + data.y);
        console.info('Succeeded in invoking on. Z-coordinate component: ' + data.z);
        console.info('Succeeded in invoking on. X-coordinate bias: ' + data.biasX);
        console.info('Succeeded in invoking on. Y-coordinate bias: ' + data.biasY);
        console.info('Succeeded in invoking on. Z-coordinate bias: ' + data.biasZ);
        this.result=this.result+"\n"+'Succeeded in invoking on. X-coordinate bias: ' + data.biasX+'\n'+
          'Succeeded in invoking on. Y-coordinate bias: ' + data.biasY+'\n'+
          'Succeeded in invoking on. Z-coordinate bias: ' + data.biasZ+'\n'
      }, { interval: 100000 });
      // setTimeout(() => {
      //   sensor.off(sensor.SensorId.ACCELEROMETER_UNCALIBRATED);
      // }, 500);
    } catch (error) {
      let e: BusinessError = error as BusinessError;
      this.result+="\n"+`Failed to invoke on ACCELEROMETER_UNCALIBRATED. Code: ${e.code}, message: ${e.message}`
      console.error(`Failed to invoke on. Code: ${e.code}, message: ${e.message}`);
    }

    try {
      sensor.on(sensor.SensorId.AMBIENT_LIGHT, (data: sensor.LightResponse) => {
        this.result+='Succeeded in getting the ambient light intensity: ' + data.intensity
        console.info('Succeeded in getting the ambient light intensity: ' + data.intensity);
      }, { interval: 100000 });
      setTimeout(() => {
        sensor.off(sensor.SensorId.AMBIENT_LIGHT);
      }, 500);
    } catch (error) {
      let e: BusinessError = error as BusinessError;
      this.result+='\n'+`Failed to invoke on AMBIENT_LIGHT. Code: ${e.code}, message: ${e.message}`
      console.error(`Failed to invoke on. Code: ${e.code}, message: ${e.message}`);
    }

    try {
      sensor.on(sensor.SensorId.BAROMETER, (data: sensor.BarometerResponse) => {
        this.result+='\n'+'Succeeded in invoking on. Atmospheric pressure: ' + data.pressure
        console.info('Succeeded in invoking on. Atmospheric pressure: ' + data.pressure);
      }, { interval: 1000000 });
      setTimeout(() => {
        sensor.off(sensor.SensorId.BAROMETER);
      }, 500);
    } catch (error) {
      let e: BusinessError = error as BusinessError;
      this.result+='\n'+`Failed to invoke on BAROMETER. Code: ${e.code}, message: ${e.message}`
      console.error(`Failed to invoke on. Code: ${e.code}, message: ${e.message}`);
    }


    try {
      sensor.on(sensor.SensorId.HEART_RATE, (data: sensor.HeartRateResponse) => {
        this.result+='\n'+'Succeeded in invoking on. Heart rate: ' + data.heartRate
        console.info('Succeeded in invoking on. Heart rate: ' + data.heartRate);
      }, { interval: 100000000 });
      setTimeout(() => {
        sensor.off(sensor.SensorId.HEART_RATE);
      }, 500);
    } catch (error) {
      let e: BusinessError = error as BusinessError;
      this.result+='\n'+`Failed to invoke on. Code HEART_RATE: ${e.code}, message: ${e.message}`
      console.error(`Failed to invoke on. Code: ${e.code}, message: ${e.message}`);
    }



  }

  build() {
    Column() {
      Text("获取sensor信息")
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .margin({ bottom: 20 });

      Button("获取sensor信息")
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .backgroundColor("#57be6a")
        .width('100%')
        .height(45)
        .borderRadius(5)
        .onClick(() => {
          this.sensor();  // 点击按钮后获取账户信息
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
