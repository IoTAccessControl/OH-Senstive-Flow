import { SceneConfig, Scene } from "./bundle";

// build config
const projectDir = 'data/Wechat_HarmonyOS';
const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);

// build scene
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

import { ArkClass } from "./bundle";
let classes: ArkClass[] = scene.getClasses();
let classNames: string[] = classes.map(cls => cls.getName());
console.log(classNames);