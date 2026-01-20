import { SceneConfig, Scene } from "./bundle";

// // 错误的官方代码
// const config_path = "tests/example.json";
// let config: SceneConfig = new SceneConfig();
// config.buildFromJson(config_path);
// let scene: Scene = new Scene(config);

// import { ArkFile } from "./bundle";
// let files: ArkFile[] = scene.getFiles();
// let fileNames: string[] = files.map(file => file.name); console.log(fileNames);

// build config
const projectDir = 'data/Wechat_HarmonyOS';
const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);

// build scene
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

import { ArkFile } from "./bundle";
let files: ArkFile[] = scene.getFiles();
let filenames: string[] = files.map(file=>file.getName());
console.log(filenames);