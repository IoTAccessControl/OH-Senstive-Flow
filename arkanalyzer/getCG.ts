import { SceneConfig, Scene, MethodSignature } from "./bundle";

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

let methods1: ArkMethod[] = scene.getMethods();
// 过滤
// let methodNames1: string[] = methods1.map(mthd => mthd.getName());
// console.log(methodNames1);
// IFDStest 
// sink/source, callgraph -> dataflow, 验证可达性 -> 模块分析，界面跳转树

let entryPoints: MethodSignature[] = []
for (let method of methods1) {
    entryPoints.push(method.getSignature())
}

import { CallGraph, CallGraphBuilder } from "./bundle";
let callGraph = new CallGraph(scene)
let callGraphBuilder = new CallGraphBuilder(callGraph, scene)
callGraphBuilder.buildClassHierarchyCallGraph(entryPoints)
callGraph.dump("result/cg.dot")