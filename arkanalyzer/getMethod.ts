import { SceneConfig, Scene } from "./bundle";

// build config
const projectDir = 'data/Wechat_HarmonyOS';
const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);

// build scene
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

import { ArkClass, ArkMethod } from "./bundle";
let classes: ArkClass[] = scene.getClasses();
let BackClass: ArkClass = classes[3];
let methods: ArkMethod[] = BackClass.getMethods(false);
let methodNames: string[] = methods.map(mthd => mthd.getName());
console.log(methodNames);

// let methods1: ArkMethod[] = scene.getMethods();
// let methodNames1: string[] = methods1.map(mthd => mthd.getName());
// console.log(methodNames1);
