# CPG 报错：No content to map 排查与解决

在其他机器上使用 `--graphBackend cpg` 时，可能出现：

```text
com.fasterxml.jackson.databind.exc.MismatchedInputException:
No content to map due to end-of-input
```

完整堆栈通常会指向 `TypeScriptLanguageFrontend.parse` 和项目的 `server/src/analyzer/cpg/generate.ts`。

## 1. 错误含义

CPG 的 TypeScript 前端会为每个 `.ets`/`.ts` 文件启动一个内置 parser 子进程。正常情况下，parser 会把源码 AST 以 JSON 写到标准输出，Java/Kotlin 前端再用 Jackson 读取。

该错误表示 parser 子进程没有输出任何 JSON，所以 Jackson 读到了空输入。它通常不是 LLM 配置或最终 `cpg.json` 损坏，而是 parser 异常退出或 CPG 安装包不匹配。

## 2. 常见原因

### 2.1 CPG 版本不一致

`lib/cpg/` 不属于主项目的 npm 依赖，新机器需要单独准备。当前验收使用的 CPG 提交为：

```text
d251e29bea84fac892134549a1d0fef0f8de25e1
```

检查：

```bash
git -C lib/cpg rev-parse HEAD
git -C lib/cpg status --short
```

直接使用其他分支、旧提交或另一台机器复制来的 `build/install`，可能导致 TypeScript 前端与 parser 资源不一致。

### 2.2 TypeScript 前端或 `.ets` 支持未启用

检查 `lib/cpg/gradle.properties`：

```properties
enableTypeScriptFrontend=true
```

再检查 `.ets` 支持：

```bash
rg -n 'fileExtensions' \
  lib/cpg/cpg-language-typescript/src/main/kotlin/de/fraunhofer/aisec/cpg/frontends/typescript/TypeScriptLanguage.kt
```

应包含：

```kotlin
override val fileExtensions = listOf("ts", "tsx", "ets")
```

如果只有 `ts`、`tsx`，说明使用的是没有适配 ArkTS 的版本。

### 2.3 修改源码后没有重新打包 CLI

即使源码已经包含 `.ets` 适配，如果仍使用旧的 `build/install/cpg-neo4j`，运行时加载的 jar 和 parser 仍可能是旧版本。

### 2.4 parser 构建产物不完整或架构不匹配

TypeScript parser 是 CPG 构建时编译并打包进 jar 的可执行文件。可能的问题包括：

- 构建中途失败但仍使用旧安装目录；
- 从另一台机器复制了 `build/install`；
- ARM 和 x86 架构不匹配；
- Java 版本不符合要求；
- 构建时下载 Deno/parser 依赖失败。
- Java 临时目录（通常是 `/tmp`）以 `noexec` 方式挂载，导致解压后的 parser 无法执行。

### 2.5 某个 ArkTS 文件触发 parser 异常

少数 ArkTS 扩展语法可能尚未被 CPG TypeScript 前端支持。此时简单文件能成功，但完整应用会失败。

## 3. 推荐修复步骤

### 3.1 固定 CPG 版本

如果尚未准备 `lib/cpg`：

```bash
git clone https://github.com/cuefe/cpg.git lib/cpg
```

然后执行：

```bash
git -C lib/cpg fetch --all
git -C lib/cpg checkout d251e29bea84fac892134549a1d0fef0f8de25e1
```

如果该目录有本地修改，先确认是否需要保留，不要直接覆盖。

### 3.2 确认环境

```bash
java -version
node --version
```

CPG 构建和运行建议使用 Java 21。Node.js 用于主项目；CPG TypeScript parser 使用构建时打包的运行资源。

同时检查 CPU 架构和临时目录挂载参数：

```bash
uname -m
findmnt -no OPTIONS /tmp 2>/dev/null || mount | rg ' /tmp '
```

如果 `/tmp` 包含 `noexec`，可以为 Java 指定一个允许执行的临时目录：

```bash
mkdir -p "$HOME/.cache/oh-cpg-tmp"
export JAVA_OPTS="${JAVA_OPTS:-} -Djava.io.tmpdir=$HOME/.cache/oh-cpg-tmp"
```

然后重新执行 CPG 单文件测试。不要把上述临时目录放在同样带有 `noexec` 的文件系统中。

### 3.3 清理并重新构建

```bash
cd lib/cpg
cp -n gradle.properties.example gradle.properties
```

确认 `gradle.properties` 至少包含：

```properties
enableTypeScriptFrontend=true
```

然后强制重新生成 parser 和 CLI：

```bash
./gradlew clean :cpg-language-typescript:processResources --rerun-tasks
./gradlew :cpg-neo4j:installDist --rerun-tasks
```

返回主项目并确认可执行文件：

```bash
cd ../..
test -x lib/cpg/cpg-neo4j/build/install/cpg-neo4j/bin/cpg-neo4j
```

还可以确认安装包中包含当前平台的 parser 资源：

```bash
jar tf lib/cpg/cpg-neo4j/build/install/cpg-neo4j/lib/cpg-language-typescript.jar \
  | rg 'typescript/parser-'
```

Linux x86_64 环境至少应看到 `typescript/parser-linux-x86_64`；ARM64 环境应看到对应的 `aarch64` 资源。

### 3.4 用最小文件验证 CPG

先创建一个简单文件：

```bash
mkdir -p /tmp/oh-cpg-check
cat > /tmp/oh-cpg-check/Simple.ets <<'EOF'
function main(): void {
  const value: string = 'ok';
  console.log(value);
}
EOF
```

再直接运行 CPG：

```bash
lib/cpg/cpg-neo4j/build/install/cpg-neo4j/bin/cpg-neo4j \
  --no-neo4j \
  --no-default-passes \
  --export-json /tmp/oh-cpg-check/result.json \
  --top-level /tmp/oh-cpg-check \
  /tmp/oh-cpg-check/Simple.ets
```

如果最小文件也报 `No content to map`，问题在 CPG/parser 的版本、构建或运行环境，而不是具体应用。

如果最小文件成功，再测试应用源码目录：

```bash
lib/cpg/cpg-neo4j/build/install/cpg-neo4j/bin/cpg-neo4j \
  --no-neo4j \
  --no-default-passes \
  --export-json /tmp/oh-cpg-check/app.json \
  --top-level input/app/Wechat_HarmonyOS \
  input/app/Wechat_HarmonyOS/entry/src/main/ets
```

## 4. 定位具体触发文件

如果最小文件成功、完整应用失败，列出待分析文件：

```bash
find input/app/Wechat_HarmonyOS/entry/src/main/ets \
  -type f \( -name '*.ets' -o -name '*.ts' \) | sort
```

先向 CPG 命令传一个文件，成功后逐步增加文件，定位最后加入的失败文件。重点检查：

- 不标准或暂不支持的 ArkTS 语法；
- 损坏、空白或非 UTF-8 文件；
- 生成代码或超大文件；
- 特殊装饰器和类型写法。

主项目的源码扫描只选择 `src/main/ets`，并排除 `src/ohosTest`，一般不需要把测试目录传给 CPG。

## 5. 重新运行主项目

确认直接调用 CPG 成功后，在主项目根目录运行：

```bash
npm run analyze -- \
  --appPath input/app/Wechat_HarmonyOS/ \
  --sdkPath input/sdk/default/openharmony/ets/ \
  --csvDir input/csv/ \
  --graphBackend cpg
```

`npm warn Unknown user config "lockfile"` 是 npm 配置警告，不是本次 CPG parser 失败的原因。

## 6. 快速判断

| 现象 | 判断 |
| --- | --- |
| 最小 `.ets` 文件也报空 JSON | CPG/parser 构建、版本、架构或环境问题 |
| 最小文件成功，某个应用失败 | 某个源码文件触发 parser 不兼容 |
| 直接运行 CPG 成功，主项目失败 | 主项目传入的文件集合或路径配置有问题 |
| 只出现 npm `lockfile` 警告 | 与 Jackson 空输入错误无关 |

优先处理顺序：固定 CPG 提交、确认 `.ets` 支持、清理并重新构建 CLI、用最小文件验证，再恢复完整应用分析。
