import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Quaternion,
  Matrix,
  SceneLoader,
} from '@babylonjs/core';
import '@babylonjs/loaders';

/** 背後肉/金條視覺上限：最多疊 200 層（thin-instance 固定此數，與實際攜帶量無關） */
const MAX_VISIBLE = 200;
/** 一層放一塊（單列往上疊，高度不限制） */
const COLS = 1;
const ROWS = 1;
const PER_LAYER = COLS * ROWS;
/** 同層肉塊的左右 / 前後間距（單列時僅作為極小抖動基準） */
const SIDE_GAP = 0.3;
const DEPTH_GAP = 0.34;
/** 每塊肉約佔的高度（堆疊層距） */
const LAYER_H = 0.15;
/** 肉堆掛在玩家背後的水平距離與起始高度 */
const BACK_OFFSET = 1;
const BASE_UP = 0.8;
/** 每往上一層往後挪一點，整堆靠在背上、略向後傾 */
const LEAN_BACK = 0.01;

/**
 * 背後肉堆：玩家撿到的肉一塊塊疊在背上，數量越多疊越高（本作招牌機制）。
 * 以單一 thin-instance mesh 繪製整堆，跟著玩家位置與面向，跑動時輕微晃動。
 */
export class BackStack {
  mesh: Mesh;

  private matrixBuffer = new Float32Array(MAX_VISIBLE * 16);
  /** 每塊的固定隨機抖動（建構時決定，逐幀穩定不閃爍） */
  private jitterX = new Float32Array(MAX_VISIBLE);
  private jitterZ = new Float32Array(MAX_VISIBLE);
  private jitterYaw = new Float32Array(MAX_VISIBLE);

  private readonly scaleVis = new Vector3(1, 1, 1);
  private readonly scaleHidden = new Vector3(0, 0, 0);
  private readonly rotQ = new Quaternion();
  private readonly posV = new Vector3();
  private readonly mat = new Matrix();

  /** 目前實際顯示的塊數，平滑趨近目標，讓肉堆生長有過渡感 */
  private shown = 0;
  private target = 0;
  private t = 0;

  /** 肉模型最長邊（載入後填入）與大小倍率（可由 debug 調整；預設 2 = 放大兩倍） */
  private modelSize = 0;
  private meatMult = 2;
  private readonly BACK_BASE = 0.52;

  /** 肉堆位置（可由 debug 調整）：往後距離、起始高度、層距 */
  private backOffset = BACK_OFFSET;
  private baseUp = BASE_UP;
  private layerH = LAYER_H;

  /** 載入的模型路徑（預設肉；可改金條等） */
  private modelDir: string;
  private modelFile: string;

  constructor(scene: Scene, modelPath = '/models/winter/meat.glb', fallbackColor = new Color3(0.86, 0.36, 0.4)) {
    const slash = modelPath.lastIndexOf('/');
    this.modelDir = modelPath.slice(0, slash + 1);
    this.modelFile = modelPath.slice(slash + 1);

    for (let i = 0; i < MAX_VISIBLE; i++) {
      /** 極小的固定抖動，讓堆疊自然但仍整齊（不亂轉） */
      this.jitterX[i] = (Math.random() - 0.5) * 0.05;
      this.jitterZ[i] = (Math.random() - 0.5) * 0.05;
      /** 相鄰層交錯一點點角度，邊緣不會完全重疊，看起來像真的疊起來 */
      this.jitterYaw[i] = (i % 2 === 0 ? 1 : -1) * 0.1;
    }

    const base = MeshBuilder.CreateBox('backmeat', { width: 0.6, height: 0.28, depth: 0.42 }, scene);
    const material = new StandardMaterial('backmeat-material', scene);
    material.diffuseColor = fallbackColor;
    material.emissiveColor = fallbackColor.scale(0.25);
    material.specularColor = Color3.Black();
    base.material = material;
    base.isPickable = false;
    base.alwaysSelectAsActiveMesh = true;
    this.mesh = base;

    for (let i = 0; i < MAX_VISIBLE; i++) this.hide(i);
    base.thinInstanceSetBuffer('matrix', this.matrixBuffer, 16, false);
    base.thinInstanceCount = MAX_VISIBLE;

    void this.loadMeat(scene);
  }

  private async loadMeat(scene: Scene) {
    try {
      const res = await SceneLoader.ImportMeshAsync('', this.modelDir, this.modelFile, scene);
      res.animationGroups.forEach((g) => g.stop());
      const parts = res.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
      const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
      res.meshes[0]?.dispose();
      if (!merged) return;
      const { min, max } = merged.getHierarchyBoundingVectors();
      const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) || 1;
      this.modelSize = size;
      const s = (this.BACK_BASE * this.meatMult) / size;
      this.scaleVis.set(s, s, s);
      merged.isPickable = false;
      merged.alwaysSelectAsActiveMesh = true;
      merged.thinInstanceSetBuffer('matrix', this.matrixBuffer, 16, false);
      merged.thinInstanceCount = MAX_VISIBLE;
      this.mesh.dispose();
      this.mesh = merged;
    } catch {
      /* 載入失敗則保留 fallback 方塊 */
    }
  }

  private hide(i: number) {
    Matrix.ComposeToRef(this.scaleHidden, this.rotQ, Vector3.ZeroReadOnly, this.mat);
    this.mat.copyToArray(this.matrixBuffer, i * 16);
  }

  /** 設定目前攜帶（已撿取）的肉數量 */
  setCount(n: number) {
    this.target = Math.max(0, n);
  }

  /**
   * 每幀更新肉堆位置：掛在玩家背後並隨面向旋轉，跑動時整堆輕微前後晃動。
   * @param yaw 玩家面向（rotation.y，模型前方為 +Z）
   * @param moving 是否在移動（決定晃動幅度）
   */
  update(dt: number, playerX: number, playerY: number, playerZ: number, yaw: number, moving: boolean) {
    this.t += dt;
    /** 平滑趨近目標數量（生長/消耗都有過渡） */
    const goal = Math.min(this.target, MAX_VISIBLE);
    this.shown += (goal - this.shown) * Math.min(1, dt * 10);
    const visible = Math.round(this.shown);

    /** 玩家面向的「前方」單位向量（模型前方 +Z）；背後為其反向 */
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    /** 側向（水平）向量，用於極小的左右抖動 */
    const sx = Math.cos(yaw);
    const sz = -Math.sin(yaw);

    /** 晃動：移動時整堆隨步伐輕擺，越高擺越多（保持整齊，只是微擺） */
    const swayAmp = moving ? 0.03 : 0.008;
    const sway = Math.sin(this.t * 9) * swayAmp;

    for (let i = 0; i < MAX_VISIBLE; i++) {
      if (i >= visible) {
        this.hide(i);
        continue;
      }
      /** 多列整齊往上疊：第 i 塊在第 layer 層的 (col,row) 格 */
      const layer = Math.floor(i / PER_LAYER);
      const slot = i % PER_LAYER;
      const col = slot % COLS;
      const row = Math.floor(slot / COLS);
      const side = (col - (COLS - 1) / 2) * SIDE_GAP + this.jitterX[i];
      const depth = (row - (ROWS - 1) / 2) * DEPTH_GAP + this.jitterZ[i];

      const up = this.baseUp + layer * this.layerH;
      /** 越高越往後靠（連同微擺），整堆貼在背上略向後傾 */
      const back = this.backOffset + depth + layer * LEAN_BACK + layer * sway;

      const ox = -fx * back + sx * side;
      const oz = -fz * back + sz * side;

      /** 平放（pitch/roll 皆 0）往上平疊；yaw 再轉 90°，讓肉的「長邊」橫面向背（而非窄邊） */
      Quaternion.RotationYawPitchRollToRef(yaw + Math.PI / 2 + this.jitterYaw[i], 0, 0, this.rotQ);
      this.posV.set(playerX + ox, playerY + up, playerZ + oz);
      Matrix.ComposeToRef(this.scaleVis, this.rotQ, this.posV, this.mat);
      this.mat.copyToArray(this.matrixBuffer, i * 16);
    }

    this.mesh.thinInstanceBufferUpdated('matrix');
  }

  /** 調整背後肉塊大小倍率（debug 用）；scaleVis 每幀套用，下一幀即生效 */
  setScale(mult: number) {
    this.meatMult = mult;
    if (this.modelSize > 0) {
      const s = (this.BACK_BASE * mult) / this.modelSize;
      this.scaleVis.set(s, s, s);
    }
  }

  /** 調整肉堆位置（debug 用）：往後距離、起始高度、層距（每幀套用，即時生效） */
  setBackOffset(v: number) {
    this.backOffset = v;
  }
  setBaseUp(v: number) {
    this.baseUp = v;
  }
  setLayerH(v: number) {
    this.layerH = v;
  }

  reset() {
    this.target = 0;
    this.shown = 0;
    for (let i = 0; i < MAX_VISIBLE; i++) this.hide(i);
    this.mesh.thinInstanceBufferUpdated('matrix');
  }
}
