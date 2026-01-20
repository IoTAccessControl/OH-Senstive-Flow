import { SceneConfig, Scene } from "./bundle";

// build config
const projectDir = 'data/Wechat_HarmonyOS';
const sceneConfig = new SceneConfig();
sceneConfig.buildFromProjectDir(projectDir);

// build scene
const scene = new Scene();
scene.buildSceneFromProjectDir(sceneConfig);

import { ArkNamespace } from "./bundle";
let namespaces: ArkNamespace[] = scene.getNamespaces();
let namespaceNames: string[] = namespaces.map(namespace => namespace.getName());
console.log(namespaceNames)