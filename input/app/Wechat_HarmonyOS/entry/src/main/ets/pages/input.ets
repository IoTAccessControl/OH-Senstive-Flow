import router from '@ohos.router';

// 可复用输入框组件 (无修改)
@Component
struct FormInput {
  label: string = ''
  placeholder: string = ''
  value: string = ''
  controller: TextInputController = new TextInputController()
  onChange?: (value: string) => void

  build() {
    Column() {
      Text(this.label)
        .fontSize(14)
        .alignSelf(ItemAlign.Start) // 确保标签左对齐
        .margin({ bottom: 10 })

      TextInput({
        placeholder: this.placeholder,
        controller: this.controller
      })
        .onChange((value: string) => { // TextInput的onChange返回的是string
          this.value = value
          this.onChange?.(value)
        })
    }
    .width('100%') // 确保Column占满宽度
    .margin({ bottom: 15 })
  }
}

interface Region {
  value: string;
  label: string;
}

@Entry
@Component
struct PersonalInfoForm {
  @State private fullName: string= "";
  @State private phoneNumber: string = "";
  @State private email: string = "";
  @State private address: string = "";
  @State private selectedRegion: string = "";
  @State private selectedGender: string = "男"; // 默认选中
  @State private agree: boolean = false;

  // 注意：'北京', '上海'等具体地名不在您的词表中。
  // 词表中包含的是 '省', '市' 等地理级别。
  private regions: Region[] = [
    { value: 'beijing', label: '北京' },
    { value: 'shanghai', label: '上海' },
    { value: 'guangdong', label: '广东' },
    { value: 'zhejiang', label: '浙江' }
  ];

  // 表单验证和提交逻辑 (无修改)
  private validateForm(): boolean { /* ... */ return true; }
  private handleSubmit() { /* ... */ }

  build() {
    Scroll() { // 使用Scroll包裹，防止内容溢出
      Column() {
        // --- 修改点：页面标题 ---
        Text("身份信息") // 来自 "identify info" -> "id cards"
          .fontSize(24) // 增大标题字号
          .fontWeight(FontWeight.Bold)
          .margin({ bottom: 30 }) // 增加标题下边距

        // --- 修改点：所有 FormInput 的 label 和 placeholder ---
        FormInput({
          label: "姓名",         // 来自 "basic info" -> "personal name"
          placeholder: "真实姓名", // 来自 "basic info" -> "personal name"
          value: this.fullName,
          onChange: (value) => { this.fullName = value; }
        })

        FormInput({
          label: "手机号",       // 来自 "basic info" -> "phone number"
          placeholder: "手机号码", // 来自 "basic info" -> "phone number"
          value: this.phoneNumber,
          onChange: (value) => { this.phoneNumber = value; }
        })

        FormInput({
          label: "电子邮箱",   // 来自 "network identify info" -> "e-mail"
          placeholder: "邮箱地址", // 来自 "network identify info" -> "e-mail"
          value: this.email,
          onChange: (value) => { this.email = value; }
        })

        FormInput({
          label: "住址",         // 来自 "basic info" -> "address"
          placeholder: "详细地址", // 来自 "basic info" -> "address"
          value: this.address,
          onChange: (value) => { this.address = value; }
        })

        // --- 修改点：性别选择区域 ---
        // --- 修改点：使用 Button 模拟单选，不再使用 RadioGroup ---
        Column() {
          Text("性别") // 来自 "basic info" -> "gender"
            .fontSize(14)
            .margin({ bottom: 10 })
            .alignSelf(ItemAlign.Start)

          Row() {
            // “男”按钮
            Button('男') // 来自 "basic info" -> "gender"
              .onClick(() => {
                // 点击时，将 selectedGender 的值设置为 '男'
                this.selectedGender = '男';
              })
              // 根据是否被选中，动态改变背景颜色
              .backgroundColor(this.selectedGender === '男' ? '#5B8EFF' : '#EFEFEF')
              // 根据是否被选中，动态改变文字颜色
              .fontColor(this.selectedGender === '男' ? Color.White : Color.Black)
              .margin({ right: 10 })

            // “女”按钮
            Button('女') // 来自 "basic info" -> "gender"
              .onClick(() => {
                // 点击时，将 selectedGender 的值设置为 '女'
                this.selectedGender = '女';
              })
              // 根据是否被选中，动态改变背景颜色
              .backgroundColor(this.selectedGender === '女' ? '#5B8EFF' : '#EFEFEF')
              // 根据是否被选中，动态改变文字颜色
              .fontColor(this.selectedGender === '女' ? Color.White : Color.Black)

          }
          .width('100%')
          .justifyContent(FlexAlign.Start)

        }.width('100%').margin({ bottom: 15 })


        // --- 修改点：地区选择区域 ---
        Column() {
          Text("所在地区") // 来自 "basic info" -> "address"
            .fontSize(14)
            .margin({ bottom: 10 })
            .alignSelf(ItemAlign.Start)

          Select(this.regions)
            .selected(0)
            .onSelect((index: number) => {
              this.selectedRegion = this.regions[index].label;
            })
            .width('100%') // 让选择框撑满
        }.width('100%').margin({ bottom: 20 })


        // --- 功能性文本，无法严格替换，保持原样 ---
        Row() {
          Toggle({ type: ToggleType.Checkbox, isOn: this.agree })
            .onChange((isOn: boolean) => { this.agree = isOn; })
          Text("我已阅读并同意用户隐私信息协议")
            .fontSize(12)
            .margin({ left: 8 })
        }.margin({ bottom: 30 })

        // --- 功能性按钮，无法严格替换，保持原样 ---
        Button("提交")
          .onClick(() => this.handleSubmit())
          .width('100%')
          .height(45)

        Button('返回主页面')
          .onClick(() => router.back())
          .width('100%')
          .height(45)
          .margin({ top: 10 })
          .backgroundColor('#EFEFEF') // 使用不同颜色区分主次按钮
          .fontColor(Color.Black)

      }
      .padding(20)
      .width('100%')
      .height('100%')
    }
  }
}