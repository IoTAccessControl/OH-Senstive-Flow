import { SceneConfig, Scene } from "./bundle";

// build config
const projectDir = 'data/Wechat_HarmonyOS';
const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);

// build scene
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

import { ArkMethod, Cfg } from "./bundle";
let methods: ArkMethod[] = scene.getMethods();
let methodCfg: Cfg = methods[0].getBody().getCfg();
console.log(methodCfg);