import { Scene, SceneLoader, TransformNode, AnimationGroup, Mesh, AssetContainer } from '@babylonjs/core';
import '@babylonjs/loaders';
// Draco 解碼器設定見 src/main.ts（進入點設定，全載入路徑共用）

export interface AnimatedModel {
  root: TransformNode;
  idle?: AnimationGroup;
  walk?: AnimationGroup;
  /** 攻擊動畫（揮刀時播放）：優先武器揮砍/突刺/射擊，其次拳擊/咬 */
  attack?: AnimationGroup;
}

/**
 * 載入角色並回傳 idle／walk 動畫群組，供呼叫端依移動狀態切換。
 * 會依世界包圍盒高度正規化縮放、底部對齊地面，預設播放 idle。失敗回傳 null。
 */
export async function loadCharacter(
  scene: Scene,
  path: string,
  targetHeight: number,
): Promise<AnimatedModel | null> {
  try {
    const slash = path.lastIndexOf('/');
    const result = await SceneLoader.ImportMeshAsync('', path.slice(0, slash + 1), path.slice(slash + 1), scene);
    const root = result.meshes[0];

    const groups = result.animationGroups;
    groups.forEach((g) => g.stop());
    const walk = groups.find((g) => /walk|run|move|sprint/i.test(g.name));
    const idle = groups.find((g) => /idle/i.test(g.name)) ?? groups[0];
    /** 攻擊動畫：優先 slash/stab/shoot，其次 punch/bite/attack */
    const attack =
      groups.find((g) => /^slash$|^stab$|slash|stab|shoot|gunplay/i.test(g.name)) ??
      groups.find((g) => /punch|bite|attack|melee/i.test(g.name));
    idle?.start(true);

    const { min, max } = root.getHierarchyBoundingVectors();
    const height = max.y - min.y || 1;
    const scale = targetHeight / height;
    root.scaling.x *= scale;
    root.scaling.y *= scale;
    root.scaling.z *= scale;
    root.position.y = -min.y * scale;

    result.meshes.forEach((m) => (m.isPickable = false));
    return { root, idle, walk, attack };
  } catch (error) {
    console.warn('[loadCharacter] 載入失敗，改用程序化造型：', path, error);
    return null;
  }
}

/** 可動模型範本：用 AssetContainer 反覆 instantiate 出多份各自帶動畫的副本 */
export interface AnimatedFleet {
  container: AssetContainer;
  /** 正規化縮放（最長邊→targetSize） */
  scale: number;
  /** 縮放後底部對齊 y=0 的位移 */
  yOffset: number;
}

/**
 * 載入「一份可大量複製的可動模型」（如牛群）。回傳 AssetContainer 與正規化資訊，
 * 呼叫端對每個個體呼叫 container.instantiateModelsToScene() 取得各自的 root 與動畫群組。
 */
export async function loadAnimatedFleet(scene: Scene, path: string, targetSize: number): Promise<AnimatedFleet | null> {
  try {
    const slash = path.lastIndexOf('/');
    const container = await SceneLoader.LoadAssetContainerAsync(path.slice(0, slash + 1), path.slice(slash + 1), scene);
    /** 用一份暫時實例量測包圍盒，算出縮放與貼地位移後丟棄 */
    const probe = container.instantiateModelsToScene((n) => `probe_${n}`, false);
    const root = probe.rootNodes[0] as TransformNode;
    const { min, max } = root.getHierarchyBoundingVectors();
    const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) || 1;
    const scale = targetSize / size;
    const yOffset = -min.y * scale;
    probe.animationGroups.forEach((g) => g.dispose());
    probe.rootNodes.forEach((n) => n.dispose());
    return { container, scale, yOffset };
  } catch (error) {
    console.warn('[loadAnimatedFleet] 載入失敗：', path, error);
    return null;
  }
}

/**
 * 載入靜態道具 GLB，合併為單一 mesh 並正規化「最長邊」到 targetSize、底部對齊 y=0。
 * 回傳合併後的 mesh（可作為 thin-instance / instance 的來源），失敗回傳 null。
 */
export async function loadProp(
  scene: Scene,
  path: string,
  targetSize: number,
  bottomAlign = true,
): Promise<Mesh | null> {
  try {
    const slash = path.lastIndexOf('/');
    const res = await SceneLoader.ImportMeshAsync('', path.slice(0, slash + 1), path.slice(slash + 1), scene);
    res.animationGroups.forEach((g) => g.stop());
    const parts = res.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    res.meshes[0]?.dispose();
    if (!merged) return null;
    const { min, max } = merged.getHierarchyBoundingVectors();
    const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) || 1;
    const s = targetSize / size;
    merged.scaling.set(s, s, s);
    /** 底部對齊 y=0（道具用）；手持武器則保留原點當握把，不對齊。烘進頂點便於重複使用 */
    if (bottomAlign) merged.position.y = -min.y * s;
    merged.bakeCurrentTransformIntoVertices();
    merged.isPickable = false;
    return merged;
  } catch (error) {
    console.warn('[loadProp] 載入失敗：', path, error);
    return null;
  }
}
