import {
  Engine,
  Scene,
  ArcRotateCamera,
  Camera,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  TransformNode,
  Mesh,
  InstancedMesh,
  DynamicTexture,
  AnimationGroup,
  AssetContainer,
} from '@babylonjs/core';
import { createTerrain } from './terrain';
import { loadCharacter, loadProp, loadAnimatedFleet, type AnimatedModel } from './model-loader';
import { BackStack } from './back-stack';
import { BloodDecals } from './decals';
import { HpBar } from './hp-bar';
import { Bubble } from './bubble';
import { CONFIG, UPGRADES, WEAPONS, START_WEAPON, type UpgradeDef, type WeaponDef } from './config';
import { sound } from './sound';

/** 場景中各檯面高度（與程序化家具尺寸對應） */
const TABLE_LEG_H = 0.85;
const TABLE_TOP_THICK = 0.18;
const COUNTER_TOP_Y = TABLE_LEG_H + TABLE_TOP_THICK; // 攤位桌面
const MEAT_SIZE = 0.95; // 肉模型正規化最長邊（攤位/顧客手上，比照原專案大小）
const BAR_SIZE = 1.05; // 金條正規化最長邊（收銀台金條，比照原專案大小）
/** 顧客買到肉時隨機冒的開心 emoji */
const HAPPY_EMOJIS = ['😋', '😄', '🥳', '❤️', '👍', '🤤'];

/** 升級面板（場景內地墊）目前狀態，回報給 HUD 顯示「站上去可升級」提示 */
export interface NearUpgradeView {
  id: string;
  name: string;
  emoji: string;
  level: number;
  maxLevel: number;
  cost: number;
  affordable: boolean;
  maxed: boolean;
}

export interface GameStats {
  fps: number;
  money: number;
  /** 玩家生命 / 上限（被牛攻擊會扣，停手會回復） */
  hp: number;
  maxHp: number;
  /** 受擊紅光暈強度（0~1，HUD 畫面邊緣泛紅） */
  damageFlash: number;
  carried: number;
  carryCap: number;
  counterMeat: number;
  counterCap: number;
  /** 收銀台待收金額 */
  cashPending: number;
  customers: number;
  /** 目前裝備的武器 */
  weaponEmoji: string;
  weaponName: string;
  /** 玩家目前踩著的升級地墊（不在任何地墊上則 null） */
  nearUpgrade: NearUpgradeView | null;
}

export interface GameOptions {
  onStats?: (s: GameStats) => void;
}

export interface GameHandle {
  dispose: () => void;
  setJoystick: (x: number, z: number) => void;
  setMuted: (on: boolean) => void;
  /** Debug：背後金條的層距（疊高間距） */
  setGoldLayerH: (v: number) => void;
  /** Debug：背後金條離肉的距離（往後位移） */
  setGoldBackOffset: (v: number) => void;
  /** Debug：鏡頭遠近（半徑） */
  setCameraRadius: (v: number) => void;
  /** Debug：鏡頭旋轉角度（弧度 alpha） */
  setCameraAlpha: (v: number) => void;
}

/** 一池同源 InstancedMesh，依傳入的位置陣列顯示前 N 個（其餘隱藏） */
class InstanceStack {
  private insts: InstancedMesh[] = [];
  private scale: number;
  constructor(source: Mesh, max: number, parent?: TransformNode, scale = 1) {
    source.isVisible = false;
    this.scale = scale;
    for (let i = 0; i < max; i++) {
      const inst = source.createInstance(`${source.name}_i${i}`);
      inst.isPickable = false;
      if (parent) inst.parent = parent;
      if (scale !== 1) inst.scaling.setAll(scale);
      inst.setEnabled(false);
      this.insts.push(inst);
    }
  }
  /** 顯示 positions.length 個實例於指定位置（local 於 parent），其餘關閉 */
  layout(positions: Vector3[], rotY = 0) {
    for (let i = 0; i < this.insts.length; i++) {
      const on = i < positions.length;
      this.insts[i].setEnabled(on);
      if (on) {
        this.insts[i].position.copyFrom(positions[i]);
        this.insts[i].rotation.y = rotY;
        if (this.scale !== 1) this.insts[i].scaling.setAll(this.scale);
      }
    }
  }
  dispose() {
    this.insts.forEach((i) => i.dispose());
    this.insts = [];
  }
}

/** 飛行物件池：把物件以拋物線從 A 飛到 B（收錢、付款、擺肉動畫共用） */
class FlyPool {
  private stack: InstanceStack | null = null;
  private active: Uint8Array;
  private t: Float32Array;
  private from: Vector3[];
  private to: Vector3[];
  private cursor = 0;
  constructor(
    private max: number,
    private dur: number,
    private arc: number,
  ) {
    this.active = new Uint8Array(max);
    this.t = new Float32Array(max);
    this.from = Array.from({ length: max }, () => new Vector3());
    this.to = Array.from({ length: max }, () => new Vector3());
  }
  init(src: Mesh, scale = 1) {
    this.stack = new InstanceStack(src, this.max, undefined, scale);
  }
  spawn(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.active[i] = 1;
    this.t[i] = 0;
    this.from[i].set(fx, fy, fz);
    this.to[i].set(tx, ty, tz);
  }
  update(dt: number) {
    if (!this.stack) return;
    const pos: Vector3[] = [];
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i]) continue;
      this.t[i] += dt / this.dur;
      if (this.t[i] >= 1) {
        this.active[i] = 0;
        continue;
      }
      const t = this.t[i];
      const fx = this.from[i].x + (this.to[i].x - this.from[i].x) * t;
      const fz = this.from[i].z + (this.to[i].z - this.from[i].z) * t;
      const fy = this.from[i].y + (this.to[i].y - this.from[i].y) * t + Math.sin(t * Math.PI) * this.arc;
      pos.push(new Vector3(fx, fy, fz));
    }
    this.stack.layout(pos);
  }
  dispose() {
    this.stack?.dispose();
  }
}

type CustState = 'enter' | 'buy' | 'leave';
interface Customer {
  root: TransformNode; // 包裝節點（控位置/朝向/縮放）
  idle?: AnimationGroup;
  walk?: AnimationGroup;
  animState: 'idle' | 'walk';
  yOffset: number;
  state: CustState;
  slot: number;
  hasMeat: boolean;
  bubble: Bubble; // 頭頂情緒泡泡
  waitTimer: number; // 排隊等待累計（決定不耐煩程度）
  bubbleTimer: number; // 開心泡泡剩餘秒數
  happyEmoji: string; // 這次買到時隨機選的開心 emoji
}

/** 一頭牛（各自帶骨骼動畫的模型副本） */
interface Cow {
  root: TransformNode; // 包裝節點（控位置/朝向/縮放）
  bar: HpBar;
  idle?: AnimationGroup;
  walk?: AnimationGroup;
  death?: AnimationGroup;
  animState: 'idle' | 'walk' | 'death';
  baseScale: number; // 正規化縮放
  yOffset: number; // 貼地位移
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  tx: number; // 遊蕩目標
  tz: number;
  pulse: number; // 被打到的縮放脈衝（0~1，衰減）
  lunge: number; // 攻擊撞擊動作（0~1，衰減）
  dying: number; // 死亡動畫剩餘秒數（>0 表示倒地動畫中）
  respawn: number; // 死亡後重生倒數
  pause: number; // 抵達目標後的停留
  walking: boolean; // 本幀是否在移動（驅動走路動畫）
  aggroTimer: number; // 已追玩家的秒數
  calmTimer: number; // 冷靜倒數（>0 不追玩家）
}

/** 地上掉落的肉 */
interface Drop {
  x: number;
  z: number;
  active: boolean;
}

export function createGame(canvas: HTMLCanvasElement, options: GameOptions = {}): GameHandle {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.62, 0.72, 0.86, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.7, 0.78, 0.9);
  scene.fogStart = 45;
  scene.fogEnd = 130;

  const cam = CONFIG.camera;
  const camera = new ArcRotateCamera('camera', cam.alpha, cam.beta, cam.radius, new Vector3(0, 0.8, 2), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = cam.lowerRadius;
  camera.upperRadiusLimit = cam.upperRadius;
  camera.lowerBetaLimit = 0.4;
  camera.upperBetaLimit = Math.PI / 2.4;
  camera.wheelPrecision = 12;
  camera.pinchPrecision = 60;
  camera.panningSensibility = 0;
  /** 手機直式框景：固定「水平」視野，畫面變高只往上下延伸，左右框景一致不縮放 */
  camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
  camera.fov = 0.95;
  /** 移除相機鍵盤輸入，讓 WASD/方向鍵專供角色移動 */
  camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');

  const hemi = new HemisphericLight('hemi', new Vector3(0.4, 1, 0.3), scene);
  hemi.intensity = 1.0;
  hemi.groundColor = new Color3(0.6, 0.68, 0.8);
  const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.3), scene);
  sun.intensity = 0.7;
  sun.diffuse = new Color3(1, 0.97, 0.9);

  createTerrain(scene);

  /** ===== 木材材質 ===== */
  const wood = new StandardMaterial('wood', scene);
  wood.diffuseColor = new Color3(0.52, 0.34, 0.17);
  wood.specularColor = Color3.Black();
  const woodLight = new StandardMaterial('wood-light', scene);
  woodLight.diffuseColor = new Color3(0.7, 0.5, 0.3);
  woodLight.specularColor = Color3.Black();

  /** ===== 店面圍場（前方 +z 留客人大門、後方 -z 留牧場通道） ===== */
  buildShopFence(scene, wood);

  /** ===== 牧場圍場（店面後方，南側留通道對齊店面後門） ===== */
  buildPastureFence(scene, wood);
  makeSign(scene, '🐄 牧場', CONFIG.pasture.cx, 2.6, CONFIG.pasture.cz + CONFIG.pasture.halfZ - 0.5);

  /** ===== 販售攤位 ===== */
  buildTable(scene, wood, CONFIG.counter.x, CONFIG.counter.z);
  makeSign(scene, '🥩 販售', CONFIG.counter.x, 2.5, CONFIG.counter.z);
  /** 肉桌前的白色透明框框：走上去把背上的肉上架 */
  makeFrameZone(scene, CONFIG.counter.x, CONFIG.counter.z - 1.8, 2.8, 2.0);

  /** ===== 收銀格 ===== */
  const cashBox = MeshBuilder.CreateBox('cash-box', { width: 1.3, height: 0.5, depth: 1.0 }, scene);
  cashBox.material = woodLight;
  cashBox.position.set(CONFIG.cash.x, 0.25, CONFIG.cash.z);
  cashBox.isPickable = false;
  /** 錢桌前的白色透明框框：走上去領錢 */
  makeFrameZone(scene, CONFIG.cash.x, CONFIG.cash.z - 1.6, 2.2, 1.8);

  /** ===== 升級地墊 ===== */
  const stations = UPGRADES.map((u) => new UpgradeStation(scene, u));

  /** ===== 玩家 ===== */
  const player = new TransformNode('player', scene);
  player.position.set(0, 0, 0);
  const fbMat = new StandardMaterial('player-fb', scene);
  fbMat.diffuseColor = new Color3(0.2, 0.5, 0.9);
  fbMat.specularColor = Color3.Black();
  const fallbackBody = MeshBuilder.CreateCapsule('player-fb-body', { radius: CONFIG.player.radius, height: 1.7 }, scene);
  fallbackBody.material = fbMat;
  fallbackBody.parent = player;
  fallbackBody.position.y = 0.85;
  let playerModel: AnimatedModel | null = null;
  let moving = false;
  /** 攻擊動畫狀態（參考原專案：揮刀後維持攻擊動作一段時間） */
  let playerAnimState: 'idle' | 'walk' | 'attack' = 'idle';
  let playerAttackTimer = 0;
  /** 背後肉堆（thin-instance，掛在背上隨步伐微擺；參考原專案 BackStack） */
  const backStack = new BackStack(scene);
  /** 背後金條堆（疊在肉的後面，數量隨金幣多寡顯示） */
  const goldStack = new BackStack(scene, '/models/winter/gold_bar.glb', new Color3(1, 0.84, 0.2));
  goldStack.setBackOffset(1.55); // 比肉更靠後（在肉的後面）
  goldStack.setBaseUp(0.8);
  goldStack.setLayerH(0.3); // 金條層距加大（否則疊太密、看起來長很慢）
  /** 背上最多顯示幾根金條（超過不再往上疊，邏輯仍計數） */
  const GOLD_BARS_MAX = 60;
  /** 付款時每花掉這麼多錢，就有一根金條從背上飛進框框 */
  const PAY_PER_BAR = 25;

  /** ===== 武器系統 ===== */
  const weaponHolder = new TransformNode('weapon-holder', scene);
  weaponHolder.parent = player;
  const weaponMeshes: (Mesh | null)[] = WEAPONS.map(() => null);
  let equipped = Math.max(0, WEAPONS.findIndex((w) => w.id === START_WEAPON));
  let swingT = 0; // 近戰揮砍進度（1→0）
  let recoilT = 0; // 槍械後座（1→0）
  let flashT = 0; // 槍口閃光殘留
  /** 槍口閃光 */
  const muzzle = MeshBuilder.CreateSphere('muzzle', { diameter: 0.3, segments: 6 }, scene);
  const muzzleMat = new StandardMaterial('muzzle-mat', scene);
  muzzleMat.emissiveColor = new Color3(1, 0.85, 0.3);
  muzzleMat.diffuseColor = Color3.Black();
  muzzleMat.specularColor = Color3.Black();
  muzzle.material = muzzleMat;
  muzzle.isPickable = false;
  muzzle.parent = weaponHolder;
  muzzle.setEnabled(false);
  /** 武器框框（基地內三個白框；要花錢買，進度條填滿才解鎖） */
  const weaponBought = WEAPONS.map((w) => w.cost <= 0);
  const weaponPaid = WEAPONS.map((w) => (w.cost <= 0 ? w.cost : 0));
  const WEAPON_BUY_TIME = 2.5; // 站著付款買滿的秒數
  const weaponStations = WEAPONS.map((w, i) => new WeaponStation(scene, w, weaponBought[i]));

  function equipWeapon(i: number) {
    equipped = i;
    weaponMeshes.forEach((m, j) => m?.setEnabled(j === i));
    weaponStations.forEach((ws, j) => ws.setEquipped(j === i));
    swingT = 0;
    recoilT = 0;
  }

  /** 玩家生命與受擊計時 */
  let hp = CONFIG.player.maxHp;
  let hurtTimer = 0;
  let damageFlash = 0;
  /** 地面血漬池 + 玩家頭頂血條 */
  const bloodDecals = new BloodDecals(scene);
  const playerBar = new HpBar(scene, 1.8, 0.26);
  playerBar.setEnabled(false);

  /** ===== 顧客池（模型載入後於 initAssets 建立可動副本） ===== */
  const customers: Customer[] = [];
  let custContainers: AssetContainer[] = [];
  /** 攤位前排位（多排位＝大量顧客同時買；沿攤位前散開） */
  /** 攤位前同時只有 2 個排位（一次 2 個客人買），其餘排隊等候 */
  const SLOT_X = [-0.9, 0.9];
  const slotOccupied: (Customer | null)[] = SLOT_X.map(() => null);
  const slotZ = CONFIG.counter.z + 2.3;
  /** 等候隊伍（沒搶到排位的客人依序排在攤位後方） */
  const queue: Customer[] = [];

  /** ===== 牛群與掉肉（模型載入後建立） ===== */
  const cows: Cow[] = [];
  const drops: Drop[] = [];
  for (let i = 0; i < CONFIG.meatDrop.max; i++) drops.push({ x: 0, z: 0, active: false });

  /** ===== instance 池 ===== */
  let counterStack: InstanceStack | null = null;
  let cashStack: InstanceStack | null = null;
  let custMeatStack: InstanceStack | null = null;
  let dropStack: InstanceStack | null = null;
  let cowContainer: AssetContainer | null = null;

  /** 金條飛行（收錢/付款）與肉飛行（背→桌）動畫池 */
  const goldFly = new FlyPool(24, 0.42, 1.6);
  const meatFly = new FlyPool(24, 0.4, 1.4);

  /** ===== 權威數值狀態 ===== */
  const levels: Record<string, number> = {};
  UPGRADES.forEach((u) => (levels[u.id] = 0));
  let money = 0;
  let carried = 0;
  let counterMeat = 0;
  let cashPending = 0; // 待收金額（金錢）
  let cashBars = 0; // 桌上待收的金條「根數」（每筆銷售 +1）
  let goldCarried = 0; // 已搬到背上的金條根數（與桌上 1:1）

  /** 由升級等級推導的數值 */
  const carryCap = () => Infinity; // 攜帶肉無上限
  const counterCap = () => Infinity; // 攤位容量無上限
  const price = () => CONFIG.counter.price;
  const attackDamage = () => WEAPONS[equipped].damage;
  const spawnInterval = () => CONFIG.customer.spawnSec;
  const playerSpeed = () => CONFIG.player.speed;

  /** 攤位肉/收銀金條的堆疊池上限（拉高到視覺上等同無限制，會一直往上疊） */
  const COUNTER_MAX = 600;
  const CASH_MAX = 600;
  /** 只有數量改變時才重排堆疊（避免大量堆疊每幀重建陣列） */
  let lastCounterN = -1;
  let lastCashN = -1;

  const P = CONFIG.pasture;
  const randPasture = (): [number, number] => [
    P.cx + (Math.random() * 2 - 1) * (P.halfX - 1),
    P.cz + (Math.random() * 2 - 1) * (P.halfZ - 1),
  ];

  /** ===== 非同步載入模型，完成後建立 instance 池、牛群、玩家視覺 ===== */
  void initAssets();
  /** ===== 地圖空白處種滿樹木與草（純裝飾，非阻塞載入） ===== */
  void scatterNature();

  /** 該點是否為「可種樹的空地」（避開店面、牧場、顧客動線） */
  function isClearForDecor(x: number, z: number): boolean {
    const a = CONFIG.arenaHalf;
    if (Math.abs(x) < a + 2 && Math.abs(z) < a + 2) return false; // 店面（含柵欄外緣）
    if (x > P.cx - P.halfX - 2 && x < P.cx + P.halfX + 2 && z > P.cz - P.halfZ - 2 && z < P.cz + P.halfZ + 2) return false; // 牧場
    if (Math.abs(x) < 5 && z > a && z < CONFIG.customer.gate.z + 4) return false; // 顧客進場動線
    return true;
  }

  async function scatterNature() {
    const [gB, gC, gD, tA, tB, tC] = await Promise.all([
      loadProp(scene, '/models/nature/Grass_2_B_Color1.glb', 0.9),
      loadProp(scene, '/models/nature/Grass_2_C_Color1.glb', 0.9),
      loadProp(scene, '/models/nature/Grass_2_D_Color1.glb', 0.9),
      loadProp(scene, '/models/nature/Tree_4_A_Color1.glb', 3.6),
      loadProp(scene, '/models/nature/Tree_4_B_Color1.glb', 3.6),
      loadProp(scene, '/models/nature/Tree_4_C_Color1.glb', 3.6),
    ]);
    const grass = [gB, gC, gD].filter((m): m is Mesh => !!m);
    const trees = [tA, tB, tC].filter((m): m is Mesh => !!m);
    grass.forEach((m) => (m.isVisible = false));
    trees.forEach((m) => (m.isVisible = false));
    const RANGE = CONFIG.arenaHalf * 3.6; // 散布半徑（落在地面範圍內）
    const place = (sources: Mesh[], count: number, minS: number, maxS: number) => {
      if (!sources.length) return;
      let placed = 0;
      for (let tries = 0; placed < count && tries < count * 10; tries++) {
        const x = (Math.random() * 2 - 1) * RANGE;
        const z = (Math.random() * 2 - 1) * RANGE;
        if (!isClearForDecor(x, z)) continue;
        const inst = sources[(Math.random() * sources.length) | 0].createInstance('deco');
        inst.isPickable = false;
        inst.position.set(x, 0, z);
        inst.rotation.y = Math.random() * Math.PI * 2;
        inst.scaling.setAll(minS + Math.random() * (maxS - minS));
        placed++;
      }
    };
    place(trees, 110, 0.8, 1.45);
    place(grass, 240, 0.7, 1.5);
  }

  async function initAssets() {
    const [meatMesh, barMesh, cowFleet, hero, cf1, cf2, cm1, cm2] = await Promise.all([
      loadProp(scene, '/models/winter/meat.glb', MEAT_SIZE),
      loadProp(scene, '/models/winter/gold_bar.glb', BAR_SIZE),
      loadAnimatedFleet(scene, '/models/cow_animated.glb', CONFIG.cow.size),
      loadCharacter(scene, '/models/shopkeeper.glb', CONFIG.player.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Female_1.glb', CONFIG.customer.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Female_2.glb', CONFIG.customer.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Male_1.glb', CONFIG.customer.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Male_2.glb', CONFIG.customer.height),
    ]);
    /** 場外北極熊（純氣氛，立在牧場後方） */
    void loadProp(scene, '/models/winter/polar_bear.glb', 3.4).then((b) => {
      if (b) b.position.set(-12, 0, P.cz - P.halfZ - 6);
    });

    const meatSrc = meatMesh ?? fallbackMeat(scene);
    const barSrc = barMesh ?? fallbackBar(scene);
    counterStack = new InstanceStack(meatSrc, COUNTER_MAX);
    custMeatStack = new InstanceStack(meatSrc, CONFIG.customer.max);
    cashStack = new InstanceStack(barSrc, CASH_MAX);
    goldFly.init(barSrc);
    meatFly.init(meatSrc);
    /** 掉落的肉大小＝背在身上的肉（BackStack ≈ 1.04，MEAT_SIZE 0.95 → 約 ×1.1） */
    dropStack = new InstanceStack(meatSrc, CONFIG.meatDrop.max, undefined, 1.1);

    /** 建立牛群：每頭牛各 instantiate 一份帶骨骼動畫的副本 */
    if (cowFleet) {
      cowContainer = cowFleet.container;
      for (let i = 0; i < CONFIG.cow.count; i++) {
        const ent = cowFleet.container.instantiateModelsToScene((n) => `cow${i}_${n}`, false);
        const gltfRoot = ent.rootNodes[0] as TransformNode;
        const holder = new TransformNode(`cow${i}`, scene);
        gltfRoot.parent = holder;
        holder.scaling.setAll(cowFleet.scale);
        ent.rootNodes.forEach((n) => (n as TransformNode).getChildMeshes?.().forEach((m) => (m.isPickable = false)));
        const g = ent.animationGroups;
        g.forEach((ag) => ag.stop());
        const walk = g.find((ag) => /walk(?!slow)/i.test(ag.name)) ?? g.find((ag) => /walk|run/i.test(ag.name));
        const idle = g.find((ag) => /idle/i.test(ag.name)) ?? g[0];
        const death = g.find((ag) => /death|die/i.test(ag.name));
        const [x, z] = randPasture();
        const [tx, tz] = randPasture();
        const c: Cow = {
          root: holder,
          bar: new HpBar(scene),
          idle,
          walk,
          death,
          animState: 'idle',
          baseScale: cowFleet.scale,
          yOffset: cowFleet.yOffset,
          x,
          z,
          hp: CONFIG.cow.hp,
          alive: true,
          tx,
          tz,
          pulse: 0,
          lunge: 0,
          dying: 0,
          respawn: 0,
          pause: 0,
          walking: false,
          aggroTimer: 0,
          calmTimer: 0,
        };
        idle?.start(true);
        applyCow(c);
        cows.push(c);
      }
    }

    if (hero) {
      hero.root.parent = player;
      fallbackBody.setEnabled(false);
      playerModel = hero;
    }

    /** 載入三種武器模型（握把原點不對齊底部），掛在手上節點，依裝備顯示其一 */
    const wmeshes = await Promise.all(WEAPONS.map((w) => loadProp(scene, w.model, w.size, false)));
    wmeshes.forEach((m, i) => {
      if (!m) return;
      m.parent = weaponHolder;
      m.position.set(0, 0, 0);
      m.isPickable = false;
      m.setEnabled(i === equipped);
      weaponMeshes[i] = m;
    });
    equipWeapon(equipped);

    /** 建立顧客池：每位顧客各 instantiate 一份（隨機四種造型）帶骨骼動畫副本 */
    custContainers = [cf1, cf2, cm1, cm2].filter((f): f is NonNullable<typeof f> => !!f).map((f) => f.container);
    const fleets = [cf1, cf2, cm1, cm2].filter((f): f is NonNullable<typeof f> => !!f);
    if (fleets.length) {
      for (let i = 0; i < CONFIG.customer.max; i++) {
        const f = fleets[i % fleets.length];
        const ent = f.container.instantiateModelsToScene((n) => `cust${i}_${n}`, false);
        const holder = new TransformNode(`cust${i}`, scene);
        (ent.rootNodes[0] as TransformNode).parent = holder;
        holder.scaling.setAll(f.scale);
        holder.setEnabled(false);
        ent.rootNodes.forEach((n) => (n as TransformNode).getChildMeshes?.().forEach((m) => (m.isPickable = false)));
        const g = ent.animationGroups;
        g.forEach((ag) => ag.stop());
        const walk = g.find((ag) => /^walk$/i.test(ag.name)) ?? g.find((ag) => /walk|run/i.test(ag.name));
        const idle = g.find((ag) => /^idle$/i.test(ag.name)) ?? g.find((ag) => /idle/i.test(ag.name)) ?? g[0];
        customers.push({
          root: holder,
          idle,
          walk,
          animState: 'idle',
          yOffset: f.yOffset,
          state: 'enter',
          slot: -1,
          hasMeat: false,
          bubble: new Bubble(scene),
          waitTimer: 0,
          bubbleTimer: 0,
          happyEmoji: '',
        });
      }
    }
  }

  /** 切換顧客動畫（idle/walk），只在改變時切換 */
  function setCustAnim(c: Customer, state: 'idle' | 'walk') {
    if (c.animState === state) return;
    c.animState = state;
    c.idle?.stop();
    c.walk?.stop();
    if (state === 'walk') c.walk?.start(true);
    else c.idle?.start(true);
  }

  /** 切換牛的動畫狀態（idle/walk/death），只在改變時切換 */
  function setCowAnim(c: Cow, state: 'idle' | 'walk' | 'death') {
    if (c.animState === state) return;
    c.animState = state;
    c.idle?.stop();
    c.walk?.stop();
    c.death?.stop();
    if (state === 'walk') c.walk?.start(true);
    else if (state === 'death') c.death?.start(false); // 死亡播一次、停在倒地
    else c.idle?.start(true);
  }

  /** 把牛的數值套到模型（位置、朝向、脈衝縮放、動畫、頭頂血條） */
  function applyCow(c: Cow) {
    const visible = c.alive || c.dying > 0;
    c.root.setEnabled(visible);
    /** 撞擊頂角時的前傾（死亡/走路交給骨骼動畫） */
    const pitch = c.alive && c.lunge > 0 ? 0.4 * c.lunge * (0.55 + 0.45 * Math.sin(elapsed * 16)) : 0;
    c.root.position.set(c.x, c.yOffset, c.z);
    c.root.scaling.setAll(c.baseScale * (1 + 0.18 * c.pulse));
    const dx = c.tx - c.x;
    const dz = c.tz - c.z;
    const yaw = dx * dx + dz * dz > 0.01 ? Math.atan2(dx, dz) + CONFIG.cow.faceOffset : c.root.rotation.y;
    c.root.rotation.set(pitch, yaw, 0);
    /** 動畫：死亡 > 走路 > idle */
    setCowAnim(c, !c.alive ? 'death' : c.walking ? 'walk' : 'idle');
    /** 頭頂血條：活著且受過傷才顯示 */
    const showBar = c.alive && c.hp < CONFIG.cow.hp;
    c.bar.setEnabled(showBar);
    if (showBar) {
      c.bar.setRatio(c.hp / CONFIG.cow.hp);
      c.bar.setPosition(c.x, CONFIG.cow.size + 0.6, c.z);
    }
  }

  /** ===== 輸入 ===== */
  let joyX = 0;
  let joyZ = 0;
  const keys: Record<string, boolean> = {};
  const onKeyDown = (e: KeyboardEvent) => {
    keys[e.key.toLowerCase()] = true;
    sound.enable();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys[e.key.toLowerCase()] = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  const firstTouch = () => sound.enable();
  canvas.addEventListener('pointerdown', firstTouch);

  /** ===== 計時器 ===== */
  let spawnAccum = 0;
  let placeAccum = 0.09;
  let cashAccum = 0.06;
  let pickAccum = 0;
  let attackAccum = 0;
  let upgradeAccum = 0;
  let statAccum = 0;
  let payFlyAccum = 0; // 付款時累積金額，每滿一份就丟一根金條飛進框框
  let elapsed = 0; // 全域時間累積（牛攻擊頭部擺動用）

  const reach = CONFIG.player.reach;
  const near = (x: number, z: number, r = reach) => {
    const dx = player.position.x - x;
    const dz = player.position.z - z;
    return dx * dx + dz * dz < r * r;
  };

  const _fwd = new Vector3();
  const _right = new Vector3();

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    elapsed += dt;

    /** --- 移動輸入 --- */
    let ix = joyX;
    let iz = joyZ;
    let kx = 0;
    let kz = 0;
    if (keys['w'] || keys['arrowup']) kz += 1;
    if (keys['s'] || keys['arrowdown']) kz -= 1;
    if (keys['d'] || keys['arrowright']) kx += 1;
    if (keys['a'] || keys['arrowleft']) kx -= 1;
    if (kx !== 0 || kz !== 0) {
      const l = Math.hypot(kx, kz);
      ix = kx / l;
      iz = kz / l;
    }
    camera.getDirectionToRef(Vector3.Forward(), _fwd);
    _fwd.y = 0;
    _fwd.normalize();
    camera.getDirectionToRef(Vector3.Right(), _right);
    _right.y = 0;
    _right.normalize();
    const wx = _right.x * ix + _fwd.x * iz;
    const wz = _right.z * ix + _fwd.z * iz;
    const mag = Math.hypot(wx, wz);
    moving = mag > 0.05;
    if (moving) {
      const sp = playerSpeed();
      player.position.x += (wx / mag) * sp * dt;
      player.position.z += (wz / mag) * sp * dt;
      clampPlayer(player.position);
      player.rotation.y = Math.atan2(wx, wz);
    }
    /** 動畫狀態：攻擊優先，其次走路、idle（僅在狀態改變時切換，參考原專案） */
    if (playerAttackTimer > 0) playerAttackTimer -= dt;
    if (playerModel) {
      const desired: 'idle' | 'walk' | 'attack' =
        playerAttackTimer > 0 && playerModel.attack ? 'attack' : moving ? 'walk' : 'idle';
      if (desired !== playerAnimState) {
        playerAnimState = desired;
        playerModel.idle?.stop();
        playerModel.walk?.stop();
        playerModel.attack?.stop();
        if (desired === 'attack') playerModel.attack?.start(true);
        else if (desired === 'walk') playerModel.walk?.start(true);
        else playerModel.idle?.start(true);
      }
    }

    /** --- 牛：追玩家攻擊 / 遊蕩 / 重生 --- */
    const cowCfg = CONFIG.cow;
    const aggro2 = cowCfg.aggroRadius * cowCfg.aggroRadius;
    const contact2 = cowCfg.contactRadius * cowCfg.contactRadius;
    let hurtThisFrame = false;
    for (const c of cows) {
      if (c.pulse > 0) c.pulse = Math.max(0, c.pulse - dt * 4);
      if (c.lunge > 0) c.lunge = Math.max(0, c.lunge - dt * 4);
      if (!c.alive) {
        /** 倒地動畫播放中 */
        if (c.dying > 0) {
          c.dying -= dt;
          applyCow(c);
          continue;
        }
        c.respawn -= dt;
        if (c.respawn <= 0) {
          const [x, z] = randPasture();
          c.x = x;
          c.z = z;
          c.hp = cowCfg.hp;
          c.alive = true;
          const [tx, tz] = randPasture();
          c.tx = tx;
          c.tz = tz;
          c.pause = 0;
          c.walking = false;
          /**
           * 重生：把骨架站回來（避免重生牛還趴在地上）。
           * 關鍵：死亡動畫播完一次後 Babylon 會自動把它設為非 started，
           * 此時單純 stop() 不會還原姿勢、也不會驅動骨頭；而 idle 只會蓋過它有 keyframe 的骨頭，
           * 死亡動畫壓到地面的髖/root 骨頭會殘留 → 牛仍趴著。
           * 故先 reset() 把死亡動畫驅動的所有骨頭強制倒回第一幀（站姿），再停掉、重播 idle。
           */
          c.death?.reset();
          c.death?.stop();
          c.walk?.stop();
          c.idle?.stop();
          c.idle?.start(true);
          c.animState = 'idle';
        }
        applyCow(c);
        continue;
      }
      if (c.calmTimer > 0) c.calmTimer -= dt;
      const pdx = player.position.x - c.x;
      const pdz = player.position.z - c.z;
      const pd2 = pdx * pdx + pdz * pdz;
      /** 只有「玩家夠近」且「不在冷靜期」才會追；否則一律遊蕩 */
      const aggroOk = pd2 < aggro2 && c.calmTimer <= 0;
      let moved = false;
      if (aggroOk) {
        c.aggroTimer += dt;
        if (c.aggroTimer >= cowCfg.maxChaseSec) {
          /** 追夠了：放棄、進入冷靜期、改去遊蕩 */
          c.aggroTimer = 0;
          c.calmTimer = cowCfg.calmSec;
          const [tx, tz] = randPasture();
          c.tx = tx;
          c.tz = tz;
          c.pause = 0;
        } else {
          const d = Math.sqrt(pd2) || 1;
          if (pd2 > contact2) {
            c.x += (pdx / d) * cowCfg.chaseSpeed * dt;
            c.z += (pdz / d) * cowCfg.chaseSpeed * dt;
            moved = true;
          } else {
            /** 接觸：播放頂角攻擊動作、造成低額傷害並擊退玩家 */
            c.lunge = 1;
            hp -= cowCfg.contactDps * dt;
            hurtThisFrame = true;
            player.position.x += (pdx / d) * cowCfg.knockback * dt;
            player.position.z += (pdz / d) * cowCfg.knockback * dt;
            clampPlayer(player.position);
          }
          c.tx = c.x;
          c.tz = c.z;
        }
      } else {
        /** 遊蕩（含冷靜期）：aggro 計時緩慢衰減 */
        if (c.aggroTimer > 0) c.aggroTimer = Math.max(0, c.aggroTimer - dt * 0.5);
        if (c.pause > 0) {
          c.pause -= dt;
        } else {
          const dx = c.tx - c.x;
          const dz = c.tz - c.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.3) {
            const [tx, tz] = randPasture();
            c.tx = tx;
            c.tz = tz;
            c.pause = 0.5 + Math.random() * 1.8;
          } else {
            c.x += (dx / d) * cowCfg.wanderSpeed * dt;
            c.z += (dz / d) * cowCfg.wanderSpeed * dt;
            moved = true;
          }
        }
      }
      c.walking = moved;
      /** 牛限制在牧場內 */
      c.x = Math.max(P.cx - P.halfX + 0.8, Math.min(P.cx + P.halfX - 0.8, c.x));
      c.z = Math.max(P.cz - P.halfZ + 0.8, Math.min(P.cz + P.halfZ - 0.8, c.z));
      applyCow(c);
    }

    /** --- 玩家生命：受擊計時、回復、紅光暈、頭頂血條 --- */
    if (hurtThisFrame) {
      hurtTimer = CONFIG.player.regenDelay;
      damageFlash = 0.65; // 觸發畫面邊緣泛紅
    } else if (hurtTimer > 0) {
      hurtTimer -= dt;
    }
    if (damageFlash > 0) damageFlash = Math.max(0, damageFlash - dt * 1.8);
    if (hurtTimer <= 0 && hp < CONFIG.player.maxHp) hp = Math.min(CONFIG.player.maxHp, hp + CONFIG.player.regen * dt);
    if (hp <= 0) {
      /** 被牛撞昏：退回店面後門、回滿血（不損失肉，維持放置友善） */
      hp = CONFIG.player.maxHp;
      hurtTimer = 0;
      player.position.set(0, 0, -CONFIG.arenaHalf + 2);
    }
    /** 玩家頭頂血條：未滿血才顯示 */
    const showPlayerBar = hp < CONFIG.player.maxHp - 0.5;
    playerBar.setEnabled(showPlayerBar);
    if (showPlayerBar) {
      playerBar.setRatio(hp / CONFIG.player.maxHp);
      playerBar.setPosition(player.position.x, CONFIG.player.height + 0.6, player.position.z);
    }

    /** --- 戰鬥：依裝備武器攻擊（近戰範圍斬／衝鋒槍遠程） --- */
    const wpn = WEAPONS[equipped];
    let faceAngle: number | null = null;
    attackAccum += dt;
    if (attackAccum >= wpn.interval) {
      /** 收集射程內的活牛，依距離排序，取前 cleave 隻 */
      const r2 = wpn.range * wpn.range;
      const inRange: { c: Cow; d: number }[] = [];
      for (const c of cows) {
        if (!c.alive) continue;
        const dx = c.x - player.position.x;
        const dz = c.z - player.position.z;
        const d = dx * dx + dz * dz;
        if (d < r2) inRange.push({ c, d });
      }
      if (inRange.length) {
        inRange.sort((a, b) => a.d - b.d);
        const targets = inRange.slice(0, wpn.cleave);
        attackAccum = 0;
        playerAttackTimer = Math.max(0.25, wpn.interval);
        const first = targets[0].c;
        faceAngle = Math.atan2(first.x - player.position.x, first.z - player.position.z);
        if (wpn.ranged) {
          recoilT = 1;
          flashT = 0.05;
          muzzle.setEnabled(true);
          sound.shoot();
        } else {
          swingT = 1;
          sound.swing();
        }
        let anyKill = false;
        let anyHit = false;
        for (const { c } of targets) {
          c.hp -= attackDamage();
          c.pulse = 1;
          if (!wpn.ranged) {
            /** 近戰擊退 */
            const ang = Math.atan2(c.x - player.position.x, c.z - player.position.z);
            c.x += Math.sin(ang) * 0.25;
            c.z += Math.cos(ang) * 0.25;
          }
          if (c.hp <= 0) {
            c.alive = false;
            c.dying = CONFIG.cow.deathSec;
            c.respawn = CONFIG.cow.respawnSec;
            c.bar.setEnabled(false);
            bloodDecals.spawn(c.x, c.z);
            for (let k = 0; k < CONFIG.cow.meatYield; k++) {
              spawnDrop(c.x + (Math.random() - 0.5) * 1.2, c.z + (Math.random() - 0.5) * 1.2);
            }
            anyKill = true;
          } else {
            anyHit = true;
          }
        }
        if (anyKill) sound.kill();
        else if (anyHit && !wpn.ranged) sound.hit();
      }
    }
    /** 攻擊時若沒在移動，讓玩家面向目標 */
    if (faceAngle !== null && !moving) player.rotation.y = faceAngle;

    /** --- 武器視覺：近戰揮砍弧線 / 槍械後座與槍口閃光 --- */
    if (swingT > 0) swingT = Math.max(0, swingT - dt / 0.22);
    if (recoilT > 0) recoilT = Math.max(0, recoilT - dt / 0.09);
    if (flashT > 0) {
      flashT -= dt;
      if (flashT <= 0) muzzle.setEnabled(false);
    }
    const swingArc = wpn.ranged ? 0 : Math.sin((1 - swingT) * Math.PI) * 1.5; // 抬起→劈下
    weaponHolder.rotation.set(wpn.hand.rx + swingArc, wpn.hand.ry, wpn.hand.rz);
    weaponHolder.position.set(wpn.hand.x, wpn.hand.y, wpn.hand.z - recoilT * 0.18);
    if (wpn.ranged) muzzle.position.set(0, 0, wpn.size * 0.6); // 槍口在前端

    /** --- 撿地上的肉 --- */
    pickAccum += dt;
    if (pickAccum >= 0.07 && carried < carryCap()) {
      const r2 = CONFIG.meatDrop.pickupRadius * CONFIG.meatDrop.pickupRadius;
      let pick: Drop | null = null;
      let pd = r2;
      for (const d of drops) {
        if (!d.active) continue;
        const dx = d.x - player.position.x;
        const dz = d.z - player.position.z;
        const dd = dx * dx + dz * dz;
        if (dd < pd) {
          pd = dd;
          pick = d;
        }
      }
      if (pick) {
        pick.active = false;
        carried++;
        pickAccum = 0;
        sound.pickup();
      }
    }

    /** --- 擺肉到攤位 --- */
    if (near(CONFIG.counter.x, CONFIG.counter.z, reach + 1) && carried > 0 && counterMeat < counterCap()) {
      placeAccum += dt;
      if (placeAccum >= 0.09) {
        placeAccum = 0;
        carried--;
        counterMeat++;
        spawnPlaceFly(); // 肉從背後飛到桌上動畫
        sound.place();
      }
    } else placeAccum = 0.09;

    /** --- 收錢：站到錢框內，一次搬一根（桌上 −1、背上 +1），金幣加上該根價值 --- */
    if (near(CONFIG.cash.x, CONFIG.cash.z, reach + 0.6) && cashBars > 0) {
      cashAccum += dt;
      if (cashAccum >= 0.12) {
        cashAccum = 0;
        /** 把待收金額平均分到剩餘金條，取出一根的價值（最後一根剛好歸零） */
        const give = Math.max(1, Math.round(cashPending / cashBars));
        const v = Math.min(give, cashPending);
        cashPending -= v;
        cashBars -= 1;
        money += v;
        goldCarried += 1; // 桌上一根 → 背上一根
        spawnCollectFly(); // 金條飛回背後動畫
        sound.cash();
      }
    } else cashAccum = 0.12;

    /** --- 飛行物件更新（金條收錢/付款、肉擺攤） --- */
    goldFly.update(dt);
    meatFly.update(dt);

    /** --- 升級 --- */
    let nearUp: NearUpgradeView | null = null;
    upgradeAccum += dt;
    for (const st of stations) {
      if (near(st.def.x, st.def.z, 1.6)) {
        const lvl = levels[st.def.id];
        const maxed = lvl >= st.def.maxLevel;
        const cost = maxed ? 0 : st.def.cost(lvl);
        nearUp = {
          id: st.def.id,
          name: st.def.name,
          emoji: st.def.emoji,
          level: lvl,
          maxLevel: st.def.maxLevel,
          cost,
          affordable: !maxed && money >= cost,
          maxed,
        };
        if (!maxed && money >= cost && upgradeAccum >= 0.32) {
          upgradeAccum = 0;
          money -= cost;
          levels[st.def.id] = lvl + 1;
          st.setLevel(lvl + 1, st.def.cost(lvl + 1), lvl + 1 >= st.def.maxLevel);
          sound.upgrade();
        }
        break;
      }
    }
    for (const st of stations) st.refreshAfford(money);

    /** --- 武器框框：未購買→站著付款（進度條），買滿解鎖並裝備；已購買→站上去切換 --- */
    for (let i = 0; i < weaponStations.length; i++) {
      const w = WEAPONS[i];
      if (!near(w.x, w.z, 2.0)) continue;
      if (!weaponBought[i]) {
        const remain = w.cost - weaponPaid[i];
        const pay = Math.min(remain, money, (w.cost / WEAPON_BUY_TIME) * dt);
        if (pay > 0) {
          weaponPaid[i] += pay;
          money -= pay;
          /** 每付掉一份金額，就從背上丟一根金條飛進框框、背後金條減一 */
          payFlyAccum += pay;
          while (payFlyAccum >= PAY_PER_BAR && goldCarried > 0) {
            payFlyAccum -= PAY_PER_BAR;
            goldCarried -= 1;
            spawnPayFly(w.x, w.z);
          }
        }
        if (weaponPaid[i] >= w.cost - 0.001) {
          weaponBought[i] = true;
          weaponPaid[i] = w.cost;
          equipWeapon(i);
          sound.upgrade();
        }
        weaponStations[i].setProgress(w.cost > 0 ? weaponPaid[i] / w.cost : 1);
      } else if (equipped !== i) {
        equipWeapon(i);
      }
    }
    for (let i = 0; i < weaponStations.length; i++) {
      weaponStations[i].setBought(weaponBought[i]);
      weaponStations[i].setEquipped(i === equipped);
    }

    /** --- 顧客生成 --- */
    spawnAccum += dt;
    const active = customers.filter((c) => c.root.isEnabled());
    if (spawnAccum >= spawnInterval() && active.length < CONFIG.customer.max) {
      spawnAccum = 0;
      const free = customers.find((c) => !c.root.isEnabled());
      if (free) {
        free.root.setEnabled(true);
        free.root.position.set(CONFIG.customer.gate.x + (Math.random() - 0.5) * 6, free.yOffset, CONFIG.customer.gate.z);
        free.state = 'enter';
        free.slot = -1;
        free.hasMeat = false;
        free.waitTimer = 0;
        free.bubbleTimer = 0;
        free.bubble.setEnabled(false);
        const qi = queue.indexOf(free);
        if (qi >= 0) queue.splice(qi, 1);
      }
    }

    /** 隊伍遞補：有空排位就讓排頭客人補上 */
    for (let s = 0; s < slotOccupied.length; s++) {
      if (!slotOccupied[s] && queue.length) {
        const c = queue.shift()!;
        c.slot = s;
        slotOccupied[s] = c;
      }
    }

    /** --- 顧客行為 --- */
    const cspeed = CONFIG.customer.speed;
    for (const c of customers) {
      if (!c.root.isEnabled()) continue;
      let tx = c.root.position.x;
      let tz = c.root.position.z;
      if (c.state === 'enter') {
        /** 排隊（沒搶到排位）就累計等待時間；拿到排位即歸零 */
        if (c.slot < 0) c.waitTimer += dt;
        else c.waitTimer = 0;
        if (c.slot < 0 && !queue.includes(c)) {
          const idx = slotOccupied.findIndex((s) => s === null);
          if (idx >= 0) {
            c.slot = idx;
            slotOccupied[idx] = c;
          } else {
            queue.push(c);
          }
        }
        if (c.slot >= 0) {
          tx = SLOT_X[c.slot];
          tz = slotZ;
          if (Math.abs(c.root.position.x - tx) < 0.2 && Math.abs(c.root.position.z - tz) < 0.2) c.state = 'buy';
        } else {
          /** 排隊：站在攤位後方排成一直線，越前面越靠攤位 */
          const qi = queue.indexOf(c);
          tx = 0;
          tz = slotZ + 1.4 + qi * 1.3;
        }
      } else if (c.state === 'buy') {
        if (counterMeat > 0) {
          counterMeat--;
          cashPending += price();
          cashBars += 1; // 每筆銷售在桌上多一根金條
          c.hasMeat = true;
          c.state = 'leave';
          if (c.slot >= 0) {
            slotOccupied[c.slot] = null;
            c.slot = -1;
          }
          /** 買到肉：隨機冒開心 emoji */
          if (Math.random() < 0.7) {
            c.bubbleTimer = 1.6;
            c.happyEmoji = HAPPY_EMOJIS[(Math.random() * HAPPY_EMOJIS.length) | 0];
          }
          sound.sell();
        }
      } else {
        tx = CONFIG.customer.gate.x + (c.root.position.x < 0 ? -1 : 1) * 2;
        tz = CONFIG.customer.gate.z + 3;
        if (c.root.position.z > CONFIG.customer.gate.z + 1.5) {
          c.root.setEnabled(false);
          c.bubble.setEnabled(false);
          c.hasMeat = false;
          const qi = queue.indexOf(c);
          if (qi >= 0) queue.splice(qi, 1);
          continue;
        }
      }
      const dx = tx - c.root.position.x;
      const dz = tz - c.root.position.z;
      const d = Math.hypot(dx, dz);
      c.root.position.y = c.yOffset;
      if (d > 0.06) {
        const step = Math.min(d, cspeed * dt);
        c.root.position.x += (dx / d) * step;
        c.root.position.z += (dz / d) * step;
        c.root.rotation.y = Math.atan2(dx, dz) + CONFIG.customer.faceOffset;
        setCustAnim(c, 'walk');
      } else {
        setCustAnim(c, 'idle');
      }
      /** 情緒泡泡：開心優先，其次依排隊等待時間分級不耐煩 */
      let emoji = '';
      if (c.bubbleTimer > 0) {
        c.bubbleTimer -= dt;
        emoji = c.happyEmoji;
      } else if (c.state === 'enter' && c.slot < 0) {
        emoji = c.waitTimer > 12 ? '😡' : c.waitTimer > 8 ? '😤' : c.waitTimer > 4 ? '😐' : '';
      }
      c.bubble.set(emoji);
      c.bubble.setPosition(c.root.position.x, CONFIG.customer.height + 0.7, c.root.position.z);
    }

    /** --- 背後肉堆 + 金條堆（金條疊在肉的後面，數量隨金幣多寡） --- */
    backStack.setCount(carried);
    backStack.update(dt, player.position.x, player.position.y, player.position.z, player.rotation.y, moving);
    goldStack.setCount(Math.min(GOLD_BARS_MAX, goldCarried));
    goldStack.update(dt, player.position.x, player.position.y, player.position.z, player.rotation.y, moving);

    /** --- 相機平滑跟隨玩家 --- */
    const f = Math.min(1, dt * cam.follow);
    camera.target.x += (player.position.x - camera.target.x) * f;
    camera.target.z += (player.position.z - camera.target.z) * f;
    camera.target.y = 0.8;

    renderStacks();

    statAccum += dt;
    if (statAccum >= 0.1) {
      statAccum = 0;
      options.onStats?.({
        fps: Math.round(engine.getFps()),
        money: Math.floor(money),
        hp: Math.max(0, Math.round(hp)),
        maxHp: CONFIG.player.maxHp,
        damageFlash,
        carried,
        carryCap: carryCap(),
        counterMeat,
        counterCap: counterCap(),
        cashPending: Math.floor(cashPending),
        customers: active.length,
        weaponEmoji: WEAPONS[equipped].emoji,
        weaponName: WEAPONS[equipped].name,
        nearUpgrade: nearUp,
      });
    }
  });

  function spawnDrop(x: number, z: number) {
    const d = drops.find((dd) => !dd.active);
    if (!d) return;
    d.active = true;
    d.x = x;
    d.z = z;
  }

  /** 玩家背後（面向反方向）約胸高的位置 */
  function playerBack(): [number, number, number] {
    const yaw = player.rotation.y;
    return [player.position.x - Math.sin(yaw) * 1.0, 1.5, player.position.z - Math.cos(yaw) * 1.0];
  }
  /** 收錢：金條從收銀台飛向玩家背後 */
  function spawnCollectFly() {
    const [bx, by, bz] = playerBack();
    goldFly.spawn(CONFIG.cash.x + (Math.random() - 0.5) * 0.5, 1.2, CONFIG.cash.z, bx, by, bz);
  }
  /** 付款：金條從玩家背後飛進框框（地面） */
  function spawnPayFly(tx: number, tz: number) {
    const [bx, by, bz] = playerBack();
    goldFly.spawn(bx, by, bz, tx + (Math.random() - 0.5) * 0.5, 0.4, tz + (Math.random() - 0.5) * 0.5);
  }
  /** 擺肉：肉從玩家背後飛到攤位上 */
  function spawnPlaceFly() {
    const [bx, by, bz] = playerBack();
    meatFly.spawn(bx, by, bz, CONFIG.counter.x + (Math.random() - 0.5) * 1.2, COUNTER_TOP_Y + 0.4, CONFIG.counter.z + (Math.random() - 0.5) * 0.6);
  }

  function renderStacks() {
    /** 攤位肉、收銀金條只在數量變動時重排（堆得再高也不影響每幀效能） */
    const cN = Math.min(counterMeat, COUNTER_MAX);
    if (counterStack && cN !== lastCounterN) {
      lastCounterN = cN;
      counterStack.layout(pilePositions(cN, CONFIG.counter.x, CONFIG.counter.z, COUNTER_TOP_Y + 0.12, 4, 0.66));
    }
    const kN = Math.min(CASH_MAX, cashBars);
    if (cashStack && kN !== lastCashN) {
      lastCashN = kN;
      cashStack.layout(barPositions(kN));
    }
    if (dropStack) {
      const pos: Vector3[] = [];
      for (const d of drops) if (d.active) pos.push(new Vector3(d.x, 0.18, d.z));
      dropStack.layout(pos);
    }
    if (custMeatStack) {
      const pos: Vector3[] = [];
      for (const c of customers) if (c.root.isEnabled() && c.hasMeat) pos.push(new Vector3(c.root.position.x, 1.15, c.root.position.z + 0.35));
      custMeatStack.layout(pos);
    }
  }

  /** 把玩家限制在「店面 ∪ 牧場 ∪ 連通走廊」範圍內 */
  function clampPlayer(p: Vector3) {
    const a = CONFIG.arenaHalf;
    const inShop = p.x >= -a + 1 && p.x <= a - 1 && p.z >= -a + 1 && p.z <= a - 1;
    /** 連通走廊：x 窄、z 從店面後門（-a+1）一路重疊到牧場內部，確保可通行 */
    const inCorridor = Math.abs(p.x) < 2.6 && p.z <= -a + 2 && p.z >= P.cz + P.halfZ - 1.2;
    const inPasture =
      p.x >= P.cx - P.halfX + 0.8 &&
      p.x <= P.cx + P.halfX - 0.8 &&
      p.z >= P.cz - P.halfZ + 0.8 &&
      p.z <= P.cz + P.halfZ - 0.8;
    if (inShop || inCorridor || inPasture) return;
    /** 超出則夾回店面範圍（最常見） */
    p.x = Math.max(-a + 1, Math.min(a - 1, p.x));
    p.z = Math.max(-a + 1, Math.min(a - 1, p.z));
  }

  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  window.addEventListener('resize', onResize);

  return {
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', firstTouch);
      backStack.mesh.dispose();
      goldStack.mesh.dispose();
      bloodDecals.dispose();
      playerBar.dispose();
      goldFly.dispose();
      meatFly.dispose();
      cows.forEach((c) => {
        c.bar.dispose();
        c.root.dispose();
      });
      cowContainer?.dispose();
      customers.forEach((c) => {
        c.root.dispose();
        c.bubble.dispose();
      });
      custContainers.forEach((cc) => cc.dispose());
      weaponStations.forEach((ws) => ws.dispose());
      counterStack?.dispose();
      cashStack?.dispose();
      custMeatStack?.dispose();
      dropStack?.dispose();
      scene.dispose();
      engine.dispose();
    },
    setJoystick(x: number, z: number) {
      joyX = x;
      joyZ = z;
    },
    setMuted(on: boolean) {
      sound.setMuted(on);
    },
    setGoldLayerH(v: number) {
      goldStack.setLayerH(v);
    },
    setGoldBackOffset(v: number) {
      goldStack.setBackOffset(v);
    },
    setCameraRadius(v: number) {
      camera.radius = v;
    },
    setCameraAlpha(v: number) {
      camera.alpha = v;
    },
  };
}

/** 堆肉位置：以 (cx,cz) 為中心、每排 perRow 塊、往後排再往上疊 */
function pilePositions(count: number, cx: number, cz: number, baseY: number, perRow: number, gap: number): Vector3[] {
  const out: Vector3[] = [];
  const layerSize = perRow * 2;
  for (let i = 0; i < count; i++) {
    const layer = Math.floor(i / layerSize);
    const inLayer = i % layerSize;
    const row = Math.floor(inLayer / perRow);
    const col = inLayer % perRow;
    const x = cx + (col - (perRow - 1) / 2) * gap;
    const z = cz + (row - 0.5) * gap;
    const y = baseY + layer * 0.22;
    out.push(new Vector3(x, y, z));
  }
  return out;
}

/** 金條堆：每層 3 條、往上疊 */
function barPositions(count: number): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const layer = Math.floor(i / 3);
    const slot = i % 3;
    out.push(new Vector3(CONFIG.cash.x + (slot - 1) * 0.52, 0.56 + layer * 0.26, CONFIG.cash.z + (layer % 2) * 0.14));
  }
  return out;
}

/** 程序化木桌 */
function buildTable(scene: Scene, wood: StandardMaterial, x: number, z: number) {
  const holder = new TransformNode('table', scene);
  holder.position.set(x, 0, z);
  const topW = 3.2;
  const topD = 1.4;
  const top = MeshBuilder.CreateBox('table-top', { width: topW, height: TABLE_TOP_THICK, depth: topD }, scene);
  top.material = wood;
  top.isPickable = false;
  top.parent = holder;
  top.position.y = TABLE_LEG_H + TABLE_TOP_THICK / 2;
  const lx = topW / 2 - 0.2;
  const lz = topD / 2 - 0.2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const leg = MeshBuilder.CreateBox('table-leg', { width: 0.18, height: TABLE_LEG_H, depth: 0.18 }, scene);
    leg.material = wood;
    leg.isPickable = false;
    leg.parent = holder;
    leg.position.set(sx * lx, TABLE_LEG_H / 2, sz * lz);
  }
}

/** 一段柵欄（柱 + 橫桿）；horizontal = 沿 x 方向 */
function fenceSeg(scene: Scene, mat: StandardMaterial, x: number, z: number, horizontal: boolean, seg: number) {
  const postH = 1.4;
  const post = MeshBuilder.CreateBox('fence-post', { width: 0.18, height: postH, depth: 0.18 }, scene);
  post.material = mat;
  post.position.set(x, postH / 2, z);
  post.isPickable = false;
  const rail = MeshBuilder.CreateBox(
    'fence-rail',
    horizontal ? { width: seg, height: 0.16, depth: 0.1 } : { width: 0.1, height: 0.16, depth: seg },
    scene,
  );
  rail.material = mat;
  rail.position.set(x, postH * 0.62, z);
  rail.isPickable = false;
}

/** 店面圍場：+z 前方留客人大門、-z 後方留牧場通道（皆在 x≈0） */
function buildShopFence(scene: Scene, wood: StandardMaterial, half = CONFIG.arenaHalf) {
  const seg = 2;
  for (let p = -half; p <= half; p += seg) {
    if (!(Math.abs(p) < 3)) fenceSeg(scene, wood, p, half, true, seg); // 前門缺口
    if (!(Math.abs(p) < 3)) fenceSeg(scene, wood, p, -half, true, seg); // 後門（往牧場）缺口
    fenceSeg(scene, wood, -half, p, false, seg);
    fenceSeg(scene, wood, half, p, false, seg);
  }
}

/** 牧場圍場：南側（z 最大、靠店面）留通道對齊店面後門 */
function buildPastureFence(scene: Scene, wood: StandardMaterial) {
  const { cx, cz, halfX, halfZ } = CONFIG.pasture;
  const seg = 2;
  for (let x = cx - halfX; x <= cx + halfX; x += seg) {
    fenceSeg(scene, wood, x, cz - halfZ, true, seg); // 北邊（外側）
    if (!(Math.abs(x - cx) < 3)) fenceSeg(scene, wood, x, cz + halfZ, true, seg); // 南邊留通道
  }
  for (let z = cz - halfZ; z <= cz + halfZ; z += seg) {
    fenceSeg(scene, wood, cx - halfX, z, false, seg);
    fenceSeg(scene, wood, cx + halfX, z, false, seg);
  }
}

/** 浮空文字招牌 */
function makeSign(scene: Scene, text: string, x: number, y: number, z: number) {
  const plane = MeshBuilder.CreatePlane('sign', { width: 2.6, height: 0.8 }, scene);
  plane.position.set(x, y, z);
  plane.isPickable = false;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const tex = new DynamicTexture('sign-tex', { width: 512, height: 158 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 512, 158);
  ctx.fillStyle = 'rgba(20,30,55,0.82)';
  roundRect(ctx, 6, 6, 500, 146, 30);
  ctx.fill();
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 82);
  tex.hasAlpha = true;
  tex.update();
  const mat = new StandardMaterial('sign-mat', scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  plane.material = mat;
}

/** 地面觸發墊 */
/** 地面白色透明框框：透明底 + 白色圓角邊框（提示玩家走上去互動） */
function makeFrameZone(scene: Scene, x: number, z: number, w: number, h: number) {
  const pad = MeshBuilder.CreateGround('frame-zone', { width: w, height: h }, scene);
  pad.position.set(x, 0.05, z);
  pad.isPickable = false;
  const TW = 256;
  const TH = Math.round((TW * h) / w);
  const tex = new DynamicTexture('frame-tex', { width: TW, height: TH }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, TW, TH);
  /** 半透明白填底（淡淡的框內）+ 不透明白邊框 */
  roundRect(ctx, 10, 10, TW - 20, TH - 20, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  tex.hasAlpha = true;
  tex.update();
  const mat = new StandardMaterial('frame-mat', scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  mat.alpha = 0.95;
  pad.material = mat;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 升級地墊：彩色圓墊 + 浮空價牌，踩上去自動升級 */
class UpgradeStation {
  readonly def: UpgradeDef;
  private tex: DynamicTexture;
  private level = 0;
  private cost: number;
  private maxed = false;
  private affordable = false;

  constructor(scene: Scene, def: UpgradeDef) {
    this.def = def;
    this.cost = def.cost(0);

    const pad = MeshBuilder.CreateDisc('up-pad', { radius: 1.4, tessellation: 32 }, scene);
    pad.rotation.x = Math.PI / 2;
    pad.position.set(def.x, 0.04, def.z);
    pad.isPickable = false;
    const padMat = new StandardMaterial('up-pad-mat', scene);
    padMat.diffuseColor = new Color3(0.95, 0.85, 0.4);
    padMat.emissiveColor = new Color3(0.5, 0.42, 0.12);
    padMat.specularColor = Color3.Black();
    pad.material = padMat;

    const plane = MeshBuilder.CreatePlane('up-sign', { width: 2.2, height: 2.0 }, scene);
    plane.position.set(def.x, 2.1, def.z);
    plane.isPickable = false;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.tex = new DynamicTexture('up-tex', { width: 256, height: 232 }, scene, false);
    const mat = new StandardMaterial('up-sign-mat', scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    plane.material = mat;
    this.redraw();
  }

  setLevel(level: number, nextCost: number, maxed: boolean) {
    this.level = level;
    this.cost = nextCost;
    this.maxed = maxed;
    this.redraw();
  }

  refreshAfford(money: number) {
    const aff = !this.maxed && money >= this.cost;
    if (aff !== this.affordable) {
      this.affordable = aff;
      this.redraw();
    }
  }

  private redraw() {
    const ctx = this.tex.getContext() as CanvasRenderingContext2D;
    const W = 256;
    const H = 232;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,30,55,0.86)';
    roundRect(ctx, 6, 6, W - 12, H - 12, 26);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '78px sans-serif';
    ctx.fillText(this.def.emoji, W / 2, 64);
    ctx.font = 'bold 34px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.def.name, W / 2, 120);
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = '#9fd3ff';
    ctx.fillText(`Lv.${this.level}/${this.def.maxLevel}`, W / 2, 158);
    ctx.font = 'bold 40px sans-serif';
    if (this.maxed) {
      ctx.fillStyle = '#ffd24a';
      ctx.fillText('MAX', W / 2, 200);
    } else {
      ctx.fillStyle = this.affordable ? '#7cf08a' : '#ff9b9b';
      ctx.fillText(`💰 ${this.cost}`, W / 2, 200);
    }
    this.tex.hasAlpha = true;
    this.tex.update();
  }
}

/** 武器框框：地墊 + 浮空牌（顯示武器與數值），踩上去即裝備；裝備中會高亮 */
class WeaponStation {
  readonly def: WeaponDef;
  private tex: DynamicTexture;
  private bought: boolean;
  private equippedNow = false;
  private progress: number;
  private lastDraw = -2;

  constructor(scene: Scene, def: WeaponDef, owned: boolean) {
    this.def = def;
    this.bought = owned;
    this.progress = owned ? 1 : 0;

    /** 放大的地面框框：武器圖案 + 價格 + 進度條都畫在框內（不另設浮空牌） */
    const ground = MeshBuilder.CreateGround('wpn-zone', { width: 3.6, height: 3.6 }, scene);
    ground.position.set(def.x, 0.06, def.z);
    ground.isPickable = false;
    this.tex = new DynamicTexture('wpn-zone-tex', { width: 256, height: 256 }, scene, false);
    const gmat = new StandardMaterial('wpn-zone-mat', scene);
    gmat.diffuseTexture = this.tex;
    gmat.emissiveTexture = this.tex;
    gmat.emissiveColor = new Color3(1, 1, 1);
    gmat.diffuseColor = Color3.Black();
    gmat.specularColor = Color3.Black();
    gmat.disableLighting = true;
    gmat.useAlphaFromDiffuseTexture = true;
    gmat.backFaceCulling = false;
    ground.material = gmat;

    this.redraw();
  }

  setProgress(r: number) {
    this.progress = Math.max(0, Math.min(1, r));
    if (Math.abs(this.progress - this.lastDraw) >= 0.02 || this.progress >= 1) this.redraw();
  }
  setBought(b: boolean) {
    if (b === this.bought) return;
    this.bought = b;
    this.progress = 1;
    this.redraw();
  }
  setEquipped(on: boolean) {
    if (on === this.equippedNow) return;
    this.equippedNow = on;
    this.redraw();
  }
  dispose() {
    this.tex.dispose();
  }

  /** 框框內：武器 emoji（大）+ 價格 + 進度條；已裝備顯示綠底「裝備中」 */
  private redraw() {
    this.lastDraw = this.progress;
    const ctx = this.tex.getContext() as CanvasRenderingContext2D;
    const W = 256;
    ctx.clearRect(0, 0, W, W);
    /** 內底色（深，讓圖示/字清楚）+ 白色框邊 */
    roundRect(ctx, 8, 8, W - 16, W - 16, 28);
    ctx.fillStyle = this.equippedNow ? 'rgba(22,90,50,0.82)' : 'rgba(18,28,52,0.78)';
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /** 武器圖案 */
    ctx.font = '104px sans-serif';
    ctx.fillText(this.def.emoji, W / 2, 84);

    if (this.bought) {
      ctx.font = 'bold 44px sans-serif';
      ctx.fillStyle = this.equippedNow ? '#9af0b0' : '#cfe6ff';
      ctx.fillText(this.equippedNow ? '裝備中' : '踩上裝備', W / 2, 178);
    } else {
      /** 價格 */
      ctx.font = 'bold 54px sans-serif';
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(`💰${this.def.cost}`, W / 2, 162);
      /** 進度條（左→右填綠） */
      const ix = 34;
      const iy = 200;
      const iw = W - 68;
      const ih = 38;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, ix, iy, iw, ih, 14);
      ctx.fill();
      if (this.progress > 0.01) {
        ctx.fillStyle = 'rgba(90,220,120,0.95)';
        roundRect(ctx, ix, iy, Math.max(14, iw * this.progress), ih, 14);
        ctx.fill();
      }
    }
    this.tex.hasAlpha = true;
    this.tex.update();
  }
}

/** 載入失敗時的程序化造型 */
function fallbackMeat(scene: Scene): Mesh {
  const m = MeshBuilder.CreateBox('meat-fb', { width: 0.5, height: 0.26, depth: 0.4 }, scene);
  const mat = new StandardMaterial('meat-fb-mat', scene);
  mat.diffuseColor = new Color3(0.86, 0.36, 0.4);
  mat.specularColor = Color3.Black();
  m.material = mat;
  m.isPickable = false;
  return m;
}

function fallbackBar(scene: Scene): Mesh {
  const m = MeshBuilder.CreateBox('bar-fb', { width: 0.42, height: 0.2, depth: 0.24 }, scene);
  const mat = new StandardMaterial('bar-fb-mat', scene);
  mat.diffuseColor = new Color3(1, 0.84, 0.2);
  mat.emissiveColor = new Color3(0.4, 0.32, 0.05);
  mat.specularColor = Color3.Black();
  m.material = mat;
  m.isPickable = false;
  return m;
}

