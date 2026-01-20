import { SceneConfig, Scene } from "./bundle";

// build config
const projectDir = 'data/Wechat_HarmonyOS';
const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);

// build scene
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

import { ArkClass, ArkField } from "./bundle";
let classes: ArkClass[] = scene.getClasses();

let BackClass: ArkClass = classes[3];
let fields: ArkField[] = BackClass.getFields();
let fieldNames: string[] = fields.map(fld => fld.getName());
console.log(fieldNames);