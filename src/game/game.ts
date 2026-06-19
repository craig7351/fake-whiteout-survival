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
  ParticleSystem,
} from '@babylonjs/core';
import { createTerrain } from './terrain';
import { loadCharacter, loadProp, loadAnimatedFleet, type AnimatedModel, type AnimatedFleet } from './model-loader';
import { BackStack } from './back-stack';
import { TreeField, type TreePlacement } from './tree-field';
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
const CUSTOMER_MEAT = 5; // 每位顧客一次最多買/拿幾片肉
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
  /** Debug：地圖樹木顯示數量 */
  setTreeCount: (v: number) => void;
  /** Debug：直接設定金錢 */
  setMoney: (v: number) => void;
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
  meatCount: number; // 身上拿著的肉片數（成交後 1~CUSTOMER_MEAT）
  bubble: Bubble; // 頭頂情緒泡泡
  waitTimer: number; // 排隊等待累計（決定不耐煩程度）
  bubbleTimer: number; // 開心泡泡剩餘秒數
  happyEmoji: string; // 這次買到時隨機選的開心 emoji
}

/** 矩形牧場區域（中心 + 半邊長） */
interface Region {
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
}

/** 一頭牛（各自帶骨骼動畫的模型副本） */
interface Cow {
  /** 所屬牧場（決定遊蕩/重生/邊界範圍） */
  pasture: Region;
  /** 是否參與更新與顯示（牧場2 的牛在解鎖前為 false） */
  active: boolean;
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
  hpMax: number; // 血量上限（牧場2 怪物為牧場1 的兩倍）
  meatYield: number; // 死亡掉肉數（牧場2 怪物為兩倍）
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

/** 牧羊犬：自動把地上的肉撿回攤位 */
interface Dog {
  root: TransformNode;
  idle?: AnimationGroup;
  walk?: AnimationGroup;
  animState: 'idle' | 'walk';
  baseScale: number;
  yOffset: number;
  x: number;
  z: number;
  state: 'seek' | 'deliver'; // 找肉 / 送回攤位
  target: Drop | null;
  carry: number; // 目前背上的肉片數（0~carryMax，背上越疊越高）
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

  /** ===== 牧場2 容器（店面西側，初始藏在樹林後；整片掛在 holder 上，買炸藥後一次開啟） ===== */
  const pasture2Holder = new TransformNode('pasture2', scene);
  pasture2Holder.setEnabled(false);
  makeSign(scene, '🐄 牧場', CONFIG.pasture.cx, 2.6, CONFIG.pasture.cz + CONFIG.pasture.halfZ - 0.5);
  makeSign(scene, '🐄 牧場2', CONFIG.pasture2.cx, 2.6, CONFIG.pasture2.cz + CONFIG.pasture2.halfZ - 0.5).parent =
    pasture2Holder;

  /**
   * ===== 圍欄（Minecraft 風 Fence_Center 模型，2 單位一段，剛好對齊 seg=2 網格） =====
   * 模型非阻塞載入，完成後再蓋柵欄（載入失敗則 fallback 程序化木欄）。
   */
  async function setupFences() {
    const center = await loadProp(scene, '/models/fence/Fence_Center.gltf', 2.0);
    if (center) center.isVisible = false;
    buildShopFence(scene, center, wood);
    buildPastureFence(scene, center, wood, CONFIG.pasture, [{ side: 'south', center: CONFIG.pasture.cx, half: 3 }]);
    buildPastureFence(scene, center, wood, CONFIG.pasture2, [{ side: 'east', center: -7, half: 3 }], pasture2Holder);
  }
  void setupFences();

  /** ===== 炸藥購買框：站著付滿 💲500 即炸開牧場2 ===== */
  const dynamiteStation = new BuyStation(scene, CONFIG.dynamite.x, CONFIG.dynamite.z, CONFIG.dynamite.cost, '🧨', '牧場2 已開通');
  let dynamitePaid = 0;
  let pasture2Unlocked = false;
  /** 爆炸時的畫面震動強度（1→0 衰減） */
  let camShake = 0;

  /** ===== 牧羊犬購買框：站著付滿 💲300 召喚一隻會自動撿肉的狗 ===== */
  const dogStation = new BuyStation(scene, CONFIG.dog.x, CONFIG.dog.z, CONFIG.dog.cost, '🐕', '已有狗狗幫手');
  let dogPaid = 0;
  let dogBought = false;
  const dogs: Dog[] = [];
  let dogFleet: AnimatedFleet | null = null;

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
  /** 玩家整體放大倍率（模型與手上武器掛在 player 節點下，一起縮放；背後堆疊另行同步） */
  const PLAYER_SCALE = 1.7;
  const player = new TransformNode('player', scene);
  player.position.set(0, 0, 0);
  player.scaling.setAll(PLAYER_SCALE);
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
  let playerAnimState: 'idle' | 'walk' | 'attack' | 'shoot' = 'idle';
  let playerAttackTimer = 0;
  /** 背後肉堆（thin-instance，掛在背上隨步伐微擺；參考原專案 BackStack）。
   *  非 player 子物件、以世界座標擺放，故各項尺寸/高度需乘上 PLAYER_SCALE 同步放大 */
  const backStack = new BackStack(scene);
  backStack.setScale(2 * PLAYER_SCALE); // 預設 meatMult=2
  backStack.setBaseUp(0.8 * PLAYER_SCALE);
  backStack.setBackOffset(1.0 * PLAYER_SCALE);
  backStack.setLayerH(0.15 * PLAYER_SCALE);
  /** 背後金條堆（疊在肉的後面，數量隨金幣多寡顯示） */
  const goldStack = new BackStack(scene, '/models/winter/gold_bar.glb', new Color3(1, 0.84, 0.2));
  goldStack.setScale(2 * PLAYER_SCALE);
  goldStack.setBackOffset(1.55 * PLAYER_SCALE); // 比肉更靠後（在肉的後面）
  goldStack.setBaseUp(0.8 * PLAYER_SCALE);
  goldStack.setLayerH(0.3 * PLAYER_SCALE); // 金條層距加大（否則疊太密、看起來長很慢）
  /** 背上最多顯示幾根金條（超過不再往上疊，邏輯仍計數） */
  const GOLD_BARS_MAX = 60;
  /** 付款時每花掉這麼多錢，就有一根金條從背上飛進框框 */
  const PAY_PER_BAR = 25;

  /** ===== 武器系統 ===== */
  const weaponHolder = new TransformNode('weapon-holder', scene);
  weaponHolder.parent = player;
  /** 武器整體放大倍率 */
  const WEAPON_SCALE = 3;
  weaponHolder.scaling.setAll(WEAPON_SCALE);
  /** 武器是否已掛到模型手骨上（成功掛上後就交給動畫帶動，不再用固定位移） */
  let weaponOnHand = false;
  /** 迴旋斧：繞玩家旋轉的節點（場景座標，每幀跟隨玩家） */
  const whirlNode = new TransformNode('whirl', scene);
  const WHIRL_RADIUS = 2.2; // 斧頭離玩家的水平距離
  const WHIRL_Y = 1.6; // 旋轉高度
  const WHIRL_SPIN = 13; // 旋轉角速度（rad/s）
  let whirlAngle = 0;
  const weaponMeshes: (Mesh | null)[] = WEAPONS.map(() => null);
  let equipped = Math.max(0, WEAPONS.findIndex((w) => w.id === START_WEAPON));
  let swingT = 0; // 近戰揮砍進度（1→0）
  let recoilT = 0; // 槍械後座（1→0）
  let flashT = 0; // 子彈軌跡殘留時間
  /** 子彈軌跡：細長發光長條，射擊時從槍口連到目標、短暫顯示 */
  const tracer = MeshBuilder.CreateBox('tracer', { width: 0.1, height: 0.1, depth: 1 }, scene);
  const tracerMat = new StandardMaterial('tracer-mat', scene);
  tracerMat.emissiveColor = new Color3(1, 0.92, 0.45);
  tracerMat.diffuseColor = Color3.Black();
  tracerMat.specularColor = Color3.Black();
  tracerMat.disableLighting = true;
  tracer.material = tracerMat;
  tracer.isPickable = false;
  tracer.setEnabled(false);
  /** 槍口偏移（沿射擊方向前移、垂直上移）：對準槍管前端用，可由 debug 調 */
  let muzzleFwd = 2.15;
  let muzzleUp = 0.65;
  /** 武器框框（基地內三個白框；要花錢買，進度條填滿才解鎖） */
  const weaponBought = WEAPONS.map((w) => w.cost <= 0);
  const weaponPaid = WEAPONS.map((w) => (w.cost <= 0 ? w.cost : 0));
  const WEAPON_BUY_TIME = 2.5; // 站著付款買滿的秒數
  const weaponStations = WEAPONS.map((w, i) => new WeaponStation(scene, w, weaponBought[i]));

  function equipWeapon(i: number) {
    equipped = i;
    const ranged = WEAPONS[i].ranged;
    /** 遠程（槍）：直接用玩家模型自帶的槍，藏起遊戲的武器 mesh；近戰：顯示對應武器 mesh、藏起模型的槍 */
    weaponMeshes.forEach((m, j) => m?.setEnabled(!ranged && j === i));
    playerModel?.builtinWeapon?.setEnabled(ranged);
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

  /** ===== 打擊特效：命中火花 / 擊殺血花（一次建立、反覆爆發，效能友善） ===== */
  const sparkTex = new DynamicTexture('spark', { width: 64, height: 64 }, scene, false);
  {
    const sc = sparkTex.getContext() as CanvasRenderingContext2D;
    const grad = sc.createRadialGradient(32, 32, 1, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, 64, 64);
    sparkTex.hasAlpha = true;
    sparkTex.update();
  }
  const makeBurst = (name: string, c1: Color4, c2: Color4, minS: number, maxS: number, life: number, power: number, add: boolean) => {
    const ps = new ParticleSystem(name, 220, scene);
    ps.particleTexture = sparkTex;
    ps.emitter = new Vector3(0, 0, 0);
    ps.minEmitBox = new Vector3(-0.15, -0.15, -0.15);
    ps.maxEmitBox = new Vector3(0.15, 0.15, 0.15);
    ps.color1 = c1;
    ps.color2 = c2;
    ps.colorDead = new Color4(c2.r, c2.g, c2.b, 0);
    ps.minSize = minS;
    ps.maxSize = maxS;
    ps.minLifeTime = life * 0.5;
    ps.maxLifeTime = life;
    ps.emitRate = 0; // 平時不噴，靠 manualEmitCount 一次性爆發
    ps.minEmitPower = power * 0.5;
    ps.maxEmitPower = power;
    ps.updateSpeed = 0.02;
    ps.gravity = new Vector3(0, -9, 0);
    ps.direction1 = new Vector3(-1, 0.6, -1);
    ps.direction2 = new Vector3(1, 1.5, 1);
    ps.blendMode = add ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    return ps;
  };
  const hitFx = makeBurst('hitfx', new Color4(1, 0.95, 0.5, 1), new Color4(1, 0.55, 0.1, 1), 0.15, 0.5, 0.32, 6, true);
  const killFx = makeBurst('killfx', new Color4(0.95, 0.12, 0.12, 1), new Color4(0.45, 0, 0, 1), 0.3, 0.95, 0.6, 8, false);
  const muzzleFx = makeBurst('muzzlefx', new Color4(1, 0.95, 0.6, 1), new Color4(1, 0.75, 0.2, 1), 0.12, 0.4, 0.12, 4, true);
  const burstAt = (ps: ParticleSystem, x: number, y: number, z: number, count: number) => {
    (ps.emitter as Vector3).set(x, y, z);
    ps.manualEmitCount = count;
  };
  /** 射擊：槍口火花 + 從槍口連到目標的子彈軌跡（短暫顯示） */
  function fireTracer(barrel: Vector3, tx: number, ty: number, tz: number) {
    /** 起點＝握把原點往射擊方向前移 muzzleFwd、垂直上移 muzzleUp（對準槍管前端） */
    const hx = tx - barrel.x;
    const hz = tz - barrel.z;
    const h = Math.hypot(hx, hz) || 1;
    const ox = barrel.x + (hx / h) * muzzleFwd;
    const oy = barrel.y + muzzleUp;
    const oz = barrel.z + (hz / h) * muzzleFwd;
    const dx = tx - ox;
    const dy = ty - oy;
    const dz = tz - oz;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    tracer.position.set(ox + dx * 0.5, oy + dy * 0.5, oz + dz * 0.5);
    tracer.scaling.set(1, 1, len);
    tracer.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0);
    tracer.setEnabled(true);
    burstAt(muzzleFx, ox, oy, oz, 8);
    flashT = 0.06;
  }

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
  let dogMeatStack: InstanceStack | null = null;
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
  // 背上金條根數直接由 money 換算（見 renderStacks），不另存計數，避免與金錢不同步

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
  const randPasture = (region: Region = P): [number, number] => [
    region.cx + (Math.random() * 2 - 1) * (region.halfX - 1),
    region.cz + (Math.random() * 2 - 1) * (region.halfZ - 1),
  ];

  /** ===== 非同步載入模型，完成後建立 instance 池、牛群、玩家視覺 ===== */
  void initAssets();
  /** ===== 地圖空白處種滿樹木與草（純裝飾，非阻塞載入） ===== */
  void scatterNature();

  /** 樹林（thin-instance）：佈滿 TREE_MAX 個固定佈點，依 treeVisible 顯示前 N 棵（debug 可調） */
  let treeField: TreeField | null = null;
  const TREE_MAX = 2000;
  let treeVisible = 2000;
  function applyTreeCount() {
    treeField?.setCount(treeVisible);
  }

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
    const RANGE = CONFIG.arenaHalf * 3.6; // 散布半徑（落在地面範圍內）

    /** 草：數量少，用 InstancedMesh 即可（均勻隨機大小） */
    const placeGrass = (sources: Mesh[], count: number, minS: number, maxS: number) => {
      if (!sources.length) return;
      for (let tries = 0, placed = 0; placed < count && tries < count * 10; tries++) {
        const x = (Math.random() * 2 - 1) * RANGE;
        const z = (Math.random() * 2 - 1) * RANGE;
        if (!isClearForDecor(x, z)) continue;
        const inst = sources[(Math.random() * sources.length) | 0].createInstance('grass');
        inst.isPickable = false;
        inst.position.set(x, 0, z);
        inst.rotation.y = Math.random() * Math.PI * 2;
        inst.scaling.setAll(minS + Math.random() * (maxS - minS));
        placed++;
      }
    };
    placeGrass(grass, 240, 0.7, 1.5);

    /**
     * 樹：數量大 → thin-instance。產生 TREE_MAX 個固定佈點，交給 TreeField 一次畫完。
     * 尺寸 80%~150% 偏態分布（skew=2.2）：多數中小、偶爾出現明顯較大的巨木。
     */
    if (trees.length) {
      const placements: TreePlacement[] = [];
      for (let tries = 0; placements.length < TREE_MAX && tries < TREE_MAX * 10; tries++) {
        const x = (Math.random() * 2 - 1) * RANGE;
        const z = (Math.random() * 2 - 1) * RANGE;
        if (!isClearForDecor(x, z)) continue;
        const r = Math.pow(Math.random(), 2.2); // 偏態：壓向小尺寸
        placements.push({
          mesh: (Math.random() * trees.length) | 0,
          x,
          z,
          rotY: Math.random() * Math.PI * 2,
          scale: 0.8 + r * (1.5 - 0.8),
        });
      }
      treeField = new TreeField(trees, placements);
      applyTreeCount();
    }
  }

  async function initAssets() {
    const [meatMesh, barMesh, cowFleet, makoFleet, dogFleetLoaded, hero, cf1, cf2, cm1, cm2] = await Promise.all([
      loadProp(scene, '/models/winter/meat.glb', MEAT_SIZE),
      loadProp(scene, '/models/winter/gold_bar.glb', BAR_SIZE),
      loadAnimatedFleet(scene, '/models/cow_animated.glb', CONFIG.cow.size),
      /** 牧場2 怪物：殭屍/海盜 Mako（含 Idle/Walk/Death 動畫） */
      loadAnimatedFleet(scene, '/models/enemies/Characters_Mako.gltf', CONFIG.cow.size),
      /** 牧羊犬（含 Idle/Walk/Run 動畫） */
      loadAnimatedFleet(scene, '/models/Characters_GermanShepherd.gltf', CONFIG.dog.size),
      loadCharacter(scene, '/models/Characters_Shaun_SingleWeapon.gltf', CONFIG.player.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Female_1.glb', CONFIG.customer.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Female_2.glb', CONFIG.customer.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Male_1.glb', CONFIG.customer.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Male_2.glb', CONFIG.customer.height),
    ]);
    dogFleet = dogFleetLoaded;
    /** 場外北極熊（純氣氛，立在牧場後方） */
    void loadProp(scene, '/models/winter/polar_bear.glb', 3.4).then((b) => {
      if (b) b.position.set(-12, 0, P.cz - P.halfZ - 6);
    });

    const meatSrc = meatMesh ?? fallbackMeat(scene);
    const barSrc = barMesh ?? fallbackBar(scene);
    counterStack = new InstanceStack(meatSrc, COUNTER_MAX);
    custMeatStack = new InstanceStack(meatSrc, CONFIG.customer.max * CUSTOMER_MEAT);
    cashStack = new InstanceStack(barSrc, CASH_MAX);
    goldFly.init(barSrc);
    meatFly.init(meatSrc);
    /** 掉落的肉大小＝背在身上的肉（BackStack ≈ 1.04，MEAT_SIZE 0.95 → 約 ×1.1） */
    dropStack = new InstanceStack(meatSrc, CONFIG.meatDrop.max, undefined, 1.1);
    /** 狗背上的肉堆（一隻狗最多背 carryMax 片，越疊越高） */
    dogMeatStack = new InstanceStack(meatSrc, CONFIG.dog.carryMax, undefined, 1.0);

    /** 建立牛群：每頭牛各 instantiate 一份帶骨骼動畫的副本 */
    if (cowFleet) {
      cowContainer = cowFleet.container;
      let cowIdx = 0;
      const makeCow = (fleet: AnimatedFleet, region: Region, active: boolean, hpMax: number, meatYield: number) => {
        const i = cowIdx++;
        const ent = fleet.container.instantiateModelsToScene((n) => `cow${i}_${n}`, false);
        const gltfRoot = ent.rootNodes[0] as TransformNode;
        const holder = new TransformNode(`cow${i}`, scene);
        gltfRoot.parent = holder;
        holder.scaling.setAll(fleet.scale);
        ent.rootNodes.forEach((n) => (n as TransformNode).getChildMeshes?.().forEach((m) => (m.isPickable = false)));
        const g = ent.animationGroups;
        g.forEach((ag) => ag.stop());
        const walk = g.find((ag) => /walk(?!slow)/i.test(ag.name)) ?? g.find((ag) => /walk|run/i.test(ag.name));
        const idle = g.find((ag) => /idle/i.test(ag.name)) ?? g[0];
        const death = g.find((ag) => /death|die/i.test(ag.name));
        const [x, z] = randPasture(region);
        const [tx, tz] = randPasture(region);
        const c: Cow = {
          pasture: region,
          active,
          root: holder,
          bar: new HpBar(scene),
          idle,
          walk,
          death,
          animState: 'idle',
          baseScale: fleet.scale,
          yOffset: fleet.yOffset,
          x,
          z,
          hp: hpMax,
          hpMax,
          meatYield,
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
        if (active) {
          idle?.start(true);
          applyCow(c);
        } else {
          holder.setEnabled(false); // 牧場2 的怪物：解鎖前完全隱藏、不更新（停用動畫省效能）
        }
        cows.push(c);
      };
      /** 牧場1：開局即有（普通牛）；牧場2：Mako 怪物，血量×2、掉肉×2，先隱藏待解鎖 */
      const monsterFleet = makoFleet ?? cowFleet;
      for (let i = 0; i < CONFIG.cow.count; i++) makeCow(cowFleet, CONFIG.pasture, true, CONFIG.cow.hp, CONFIG.cow.meatYield);
      for (let i = 0; i < CONFIG.cow.count; i++)
        makeCow(monsterFleet, CONFIG.pasture2, false, CONFIG.cow.hp * 2, CONFIG.cow.meatYield * 2);
    }

    if (hero) {
      hero.root.parent = player;
      fallbackBody.setEnabled(false);
      playerModel = hero;
    }

    /** 載入三種武器模型（握把原點不對齊底部），掛在 weaponHolder 上，依裝備顯示其一 */
    const wmeshes = await Promise.all(WEAPONS.map((w) => loadProp(scene, w.model, w.size, false)));
    wmeshes.forEach((m, i) => {
      if (!m) return;
      m.parent = weaponHolder;
      m.position.set(0, 0, 0);
      /** 各武器握法微調（相對手部的旋轉） */
      m.rotation.set(WEAPONS[i].hand.rx, WEAPONS[i].hand.ry, WEAPONS[i].hand.rz);
      m.isPickable = false;
      m.setEnabled(i === equipped);
      weaponMeshes[i] = m;
    });
    /**
     * 把武器掛到模型握武器的手骨上（內建 SMG 的父節點），與內建武器同位置，
     * 之後就跟著 Slash/持槍 動畫擺動；並抵銷手骨累積縮放讓武器維持正規化大小。
     */
    const handNode = (playerModel?.builtinWeapon?.parent as TransformNode | undefined) ?? undefined;
    if (handNode && playerModel?.builtinWeapon) {
      const smg = playerModel.builtinWeapon;
      weaponHolder.parent = handNode;
      weaponHolder.position.copyFrom(smg.position);
      weaponHolder.rotationQuaternion = smg.rotationQuaternion ? smg.rotationQuaternion.clone() : null;
      if (!weaponHolder.rotationQuaternion) weaponHolder.rotation.copyFrom(smg.rotation);
      handNode.computeWorldMatrix(true);
      const sc = new Vector3();
      handNode.getWorldMatrix().decompose(sc, undefined, undefined);
      /** 抵銷手骨累積縮放，再乘上 WEAPON_SCALE（放大武器） */
      weaponHolder.scaling.set(WEAPON_SCALE / (sc.x || 1), WEAPON_SCALE / (sc.y || 1), WEAPON_SCALE / (sc.z || 1));
      weaponOnHand = true;
    }
    /** 迴旋斧：把斧頭 mesh 從手上移到 whirlNode、置於軌道半徑處（場景座標、固定大小） */
    const whirlIdx = WEAPONS.findIndex((w) => w.whirl);
    const whirlMesh = whirlIdx >= 0 ? weaponMeshes[whirlIdx] : null;
    if (whirlMesh) {
      whirlMesh.parent = whirlNode;
      whirlMesh.position.set(WHIRL_RADIUS, 0, 0);
      whirlMesh.rotation.set(Math.PI / 2, 0, 0); // 斧頭放平、隨節點旋轉甩動
      whirlMesh.scaling.setAll(WEAPON_SCALE);
    }
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
          meatCount: 0,
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
    const showBar = c.alive && c.hp < c.hpMax;
    c.bar.setEnabled(showBar);
    if (showBar) {
      c.bar.setRatio(c.hp / c.hpMax);
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
    /** 動畫狀態：攻擊優先（裝槍用射擊姿勢），其次走路、idle（僅在狀態改變時切換） */
    if (playerAttackTimer > 0) playerAttackTimer -= dt;
    if (playerModel) {
      const ranged = WEAPONS[equipped].ranged;
      let desired: 'idle' | 'walk' | 'attack' | 'shoot' = moving ? 'walk' : 'idle';
      if (playerAttackTimer > 0) {
        if (ranged && playerModel.shoot) desired = 'shoot';
        else if (!ranged && playerModel.attack) desired = 'attack';
      }
      if (desired !== playerAnimState) {
        playerAnimState = desired;
        playerModel.idle?.stop();
        playerModel.walk?.stop();
        playerModel.attack?.stop();
        playerModel.shoot?.stop();
        const ag =
          desired === 'attack'
            ? playerModel.attack
            : desired === 'shoot'
              ? playerModel.shoot
              : desired === 'walk'
                ? playerModel.walk
                : playerModel.idle;
        ag?.start(true);
      }
    }

    /** --- 牛：追玩家攻擊 / 遊蕩 / 重生 --- */
    const cowCfg = CONFIG.cow;
    const aggro2 = cowCfg.aggroRadius * cowCfg.aggroRadius;
    const contact2 = cowCfg.contactRadius * cowCfg.contactRadius;
    let hurtThisFrame = false;
    for (const c of cows) {
      if (!c.active) continue; // 牧場2 未解鎖前的牛不參與更新
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
          const [x, z] = randPasture(c.pasture);
          c.x = x;
          c.z = z;
          c.hp = c.hpMax;
          c.alive = true;
          const [tx, tz] = randPasture(c.pasture);
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
          const [tx, tz] = randPasture(c.pasture);
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
            const [tx, tz] = randPasture(c.pasture);
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
      /** 牛限制在所屬牧場內 */
      const pg = c.pasture;
      c.x = Math.max(pg.cx - pg.halfX + 0.8, Math.min(pg.cx + pg.halfX - 0.8, c.x));
      c.z = Math.max(pg.cz - pg.halfZ + 0.8, Math.min(pg.cz + pg.halfZ - 0.8, c.z));
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
      playerBar.setPosition(player.position.x, CONFIG.player.height * PLAYER_SCALE + 0.6, player.position.z);
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
        if (!c.active || !c.alive) continue;
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
          /** 從槍口（模型自帶 SMG 節點）連一條子彈軌跡到第一目標 + 槍口火花 */
          const barrel = playerModel?.builtinWeapon?.getAbsolutePosition() ?? weaponHolder.getAbsolutePosition();
          fireTracer(barrel, first.x, 1.2, first.z);
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
            burstAt(killFx, c.x, 1.0, c.z, 26); // 擊殺血花
            for (let k = 0; k < c.meatYield; k++) {
              spawnDrop(c.x + (Math.random() - 0.5) * 1.2, c.z + (Math.random() - 0.5) * 1.2);
            }
            anyKill = true;
          } else {
            burstAt(hitFx, c.x, 1.2, c.z, 14); // 命中火花
            anyHit = true;
          }
        }
        if (anyKill) sound.kill();
        else if (anyHit && !wpn.ranged) sound.hit(); // 近戰命中打擊聲（槍靠 shoot() 已有回饋，避免連發吵雜）
      }
    }
    /** 攻擊時若沒在移動，讓玩家面向目標 */
    if (faceAngle !== null && !moving) player.rotation.y = faceAngle;

    /** --- 武器視覺：近戰揮砍弧線 / 槍械後座與槍口閃光 --- */
    if (swingT > 0) swingT = Math.max(0, swingT - dt / 0.22);
    if (recoilT > 0) recoilT = Math.max(0, recoilT - dt / 0.09);
    if (flashT > 0) {
      flashT -= dt;
      if (flashT <= 0) tracer.setEnabled(false);
    }
    /** 已掛在手骨上時，擺動交給角色動畫（Slash/持槍）；否則用固定位移＋程序化揮砍 */
    if (!weaponOnHand) {
      const swingArc = wpn.ranged ? 0 : Math.sin((1 - swingT) * Math.PI) * 1.5; // 抬起→劈下
      weaponHolder.rotation.set(wpn.hand.rx + swingArc, wpn.hand.ry, wpn.hand.rz);
      weaponHolder.position.set(wpn.hand.x, wpn.hand.y, wpn.hand.z - recoilT * 0.18);
    }

    /** --- 迴旋斧：裝備時斧頭持續繞玩家旋轉甩動（傷害靠 cleave 命中範圍內全部怪物） --- */
    if (wpn.whirl) {
      whirlAngle += WHIRL_SPIN * dt;
      whirlNode.position.set(player.position.x, WHIRL_Y, player.position.z);
      whirlNode.rotation.y = whirlAngle;
    }

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

    /** --- 擺肉到攤位（速度 ×2） --- */
    if (near(CONFIG.counter.x, CONFIG.counter.z, reach + 1) && carried > 0 && counterMeat < counterCap()) {
      placeAccum += dt;
      if (placeAccum >= 0.045) {
        placeAccum = 0;
        carried--;
        counterMeat++;
        spawnPlaceFly(); // 肉從背後飛到桌上動畫
        sound.place();
      }
    } else placeAccum = 0.045;

    /** --- 收錢：站到錢框內，一次搬一根（桌上 −1、背上 +1），金幣加上該根價值（速度 ×4） --- */
    if (near(CONFIG.cash.x, CONFIG.cash.z, reach + 0.6) && cashBars > 0) {
      cashAccum += dt;
      if (cashAccum >= 0.05) {
        cashAccum = 0;
        /** 把待收金額平均分到剩餘金條，取出一根的價值（最後一根剛好歸零） */
        const give = Math.max(1, Math.round(cashPending / cashBars));
        const v = Math.min(give, cashPending);
        cashPending -= v;
        cashBars -= 1;
        money += v;
        spawnCollectFly(); // 金條飛回背後動畫（背上根數由 money 換算）
        sound.cash();
      }
    } else cashAccum = 0.05;

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
          while (payFlyAccum >= PAY_PER_BAR) {
            payFlyAccum -= PAY_PER_BAR;
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

    /** --- 炸藥框：站著付款（進度條），付滿即炸開牧場2 --- */
    if (!pasture2Unlocked) {
      const D = CONFIG.dynamite;
      if (near(D.x, D.z, 2.0) && money > 0) {
        const remain = D.cost - dynamitePaid;
        const pay = Math.min(remain, money, (D.cost / WEAPON_BUY_TIME) * dt);
        if (pay > 0) {
          dynamitePaid += pay;
          money -= pay;
          payFlyAccum += pay;
          while (payFlyAccum >= PAY_PER_BAR) {
            payFlyAccum -= PAY_PER_BAR;
            spawnPayFly(D.x, D.z);
          }
        }
        dynamiteStation.setProgress(D.cost > 0 ? dynamitePaid / D.cost : 1);
        if (dynamitePaid >= D.cost - 0.001) {
          dynamiteStation.setDone();
          revealPasture2();
        }
      }
    }

    /** --- 牧羊犬框：站著付款（進度條），付滿即召喚一隻會撿肉的狗 --- */
    if (!dogBought) {
      const G = CONFIG.dog;
      if (near(G.x, G.z, 2.0) && money > 0) {
        const remain = G.cost - dogPaid;
        const pay = Math.min(remain, money, (G.cost / WEAPON_BUY_TIME) * dt);
        if (pay > 0) {
          dogPaid += pay;
          money -= pay;
          payFlyAccum += pay;
          while (payFlyAccum >= PAY_PER_BAR) {
            payFlyAccum -= PAY_PER_BAR;
            spawnPayFly(G.x, G.z);
          }
        }
        dogStation.setProgress(G.cost > 0 ? dogPaid / G.cost : 1);
        if (dogPaid >= G.cost - 0.001) {
          dogBought = true;
          dogStation.setDone();
          spawnDog();
          sound.upgrade();
        }
      }
    }

    /** --- 牧羊犬行為：找地上的肉 → 叼回攤位 --- */
    updateDogs(dt);

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
        free.meatCount = 0;
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
          /** 一次拿走最多 CUSTOMER_MEAT 片（不足就拿剩下的） */
          const take = Math.min(CUSTOMER_MEAT, counterMeat);
          counterMeat -= take;
          cashPending += price() * take;
          cashBars += take; // 每片肉在桌上多一根金條
          c.meatCount = take;
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
          c.meatCount = 0;
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
    goldStack.setCount(Math.min(GOLD_BARS_MAX, Math.floor(money / PAY_PER_BAR)));
    goldStack.update(dt, player.position.x, player.position.y, player.position.z, player.rotation.y, moving);

    /** --- 相機平滑跟隨玩家（爆炸時加上短暫震動） --- */
    const f = Math.min(1, dt * cam.follow);
    camera.target.x += (player.position.x - camera.target.x) * f;
    camera.target.z += (player.position.z - camera.target.z) * f;
    camera.target.y = 0.8;
    if (camShake > 0) {
      camShake = Math.max(0, camShake - dt * 2);
      const s = camShake * 0.6;
      camera.target.x += (Math.random() * 2 - 1) * s;
      camera.target.z += (Math.random() * 2 - 1) * s;
    }

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

  /** 一次性爆炸煙塵粒子（炸開牧場2 用） */
  function spawnExplosion(x: number, y: number, z: number) {
    const puff = new DynamicTexture('puff', { width: 64, height: 64 }, scene, false);
    const pc = puff.getContext() as CanvasRenderingContext2D;
    const grad = pc.createRadialGradient(32, 32, 1, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    pc.fillStyle = grad;
    pc.fillRect(0, 0, 64, 64);
    puff.hasAlpha = true;
    puff.update();

    const ps = new ParticleSystem('boom', 400, scene);
    ps.particleTexture = puff;
    ps.emitter = new Vector3(x, y, z);
    ps.minEmitBox = new Vector3(-1.5, -0.5, -1.5);
    ps.maxEmitBox = new Vector3(1.5, 1.5, 1.5);
    ps.color1 = new Color4(0.95, 0.78, 0.45, 1);
    ps.color2 = new Color4(0.55, 0.55, 0.6, 1);
    ps.colorDead = new Color4(0.3, 0.3, 0.32, 0);
    ps.minSize = 0.8;
    ps.maxSize = 3.0;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 1.1;
    ps.emitRate = 1600;
    ps.minEmitPower = 5;
    ps.maxEmitPower = 13;
    ps.updateSpeed = 0.02;
    ps.gravity = new Vector3(0, -7, 0);
    ps.direction1 = new Vector3(-1.2, 1.5, -1.2);
    ps.direction2 = new Vector3(1.2, 2.5, 1.2);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.disposeOnStop = true;
    ps.targetStopDuration = 0.25; // 短暫噴發後自動停止並釋放
    ps.start();
    setTimeout(() => puff.dispose(), 2500);
  }

  /** 炸開牧場2：清樹、顯示柵欄/招牌、啟用牛群、特效 */
  function revealPasture2() {
    if (pasture2Unlocked) return;
    pasture2Unlocked = true;
    pasture2Holder.setEnabled(true);
    /** 清掉牧場2 與西側走道範圍內的樹林 */
    treeField?.hideRegion(-37, -9, -12, 8);
    /** 啟用牧場2 的牛群 */
    for (const c of cows) {
      if (c.pasture !== CONFIG.pasture2 || c.active) continue;
      c.active = true;
      const [x, z] = randPasture(c.pasture);
      const [tx, tz] = randPasture(c.pasture);
      c.x = x;
      c.z = z;
      c.tx = tx;
      c.tz = tz;
      c.hp = c.hpMax;
      c.alive = true;
      c.dying = 0;
      c.respawn = 0;
      c.root.setEnabled(true);
      c.idle?.start(true);
      c.animState = 'idle';
      applyCow(c);
    }
    /** 特效：靠近店面側炸開（玩家看得到）+ 畫面震動 + 音效 */
    spawnExplosion(CONFIG.pasture2.cx + CONFIG.pasture2.halfX - 4, 1.5, -4);
    spawnExplosion(-11, 1.5, -6);
    camShake = 1;
    sound.boom();
  }

  /** 切換狗的動畫（idle/walk），只在改變時切換 */
  function setDogAnim(dog: Dog, state: 'idle' | 'walk') {
    if (dog.animState === state) return;
    dog.animState = state;
    dog.idle?.stop();
    dog.walk?.stop();
    if (state === 'walk') dog.walk?.start(true);
    else dog.idle?.start(true);
  }

  /** 召喚一隻牧羊犬（從 dogFleet 複製一份帶動畫的副本） */
  function spawnDog() {
    if (!dogFleet) return;
    const ent = dogFleet.container.instantiateModelsToScene((n) => `dog${dogs.length}_${n}`, false);
    const holder = new TransformNode(`dog${dogs.length}`, scene);
    (ent.rootNodes[0] as TransformNode).parent = holder;
    holder.scaling.setAll(dogFleet.scale);
    ent.rootNodes.forEach((n) => (n as TransformNode).getChildMeshes?.().forEach((m) => (m.isPickable = false)));
    const g = ent.animationGroups;
    g.forEach((ag) => ag.stop());
    const walk = g.find((ag) => /^walk$/i.test(ag.name)) ?? g.find((ag) => /walk|run/i.test(ag.name));
    const idle = g.find((ag) => /^idle$/i.test(ag.name)) ?? g.find((ag) => /idle/i.test(ag.name)) ?? g[0];
    /** 從攤位旁出生 */
    const sx = CONFIG.counter.x + 2;
    const sz = CONFIG.counter.z - 2;
    holder.position.set(sx, dogFleet.yOffset, sz);
    idle?.start(true);
    dogs.push({
      root: holder,
      idle,
      walk,
      animState: 'idle',
      baseScale: dogFleet.scale,
      yOffset: dogFleet.yOffset,
      x: sx,
      z: sz,
      state: 'seek',
      target: null,
      carry: 0,
    });
  }

  /** 狗 AI：seek＝找最近的地上肉並走過去撿；deliver＝把肉叼回攤位上架 */
  function updateDogs(dt: number) {
    if (!dogs.length) return;
    const speed = CONFIG.dog.speed;
    const pr2 = CONFIG.dog.pickRadius * CONFIG.dog.pickRadius;
    /** 攤位前的放肉點 */
    const depotX = CONFIG.counter.x;
    const depotZ = CONFIG.counter.z - 1.6;
    for (const dog of dogs) {
      let tx = dog.x;
      let tz = dog.z;
      if (dog.state === 'seek') {
        /** 目標若已被撿走（玩家或別隻狗），重找最近的 */
        if (!dog.target || !dog.target.active) {
          dog.target = null;
          let bd = Infinity;
          for (const dr of drops) {
            if (!dr.active) continue;
            const q = (dr.x - dog.x) ** 2 + (dr.z - dog.z) ** 2;
            if (q < bd) {
              bd = q;
              dog.target = dr;
            }
          }
        }
        if (dog.target) {
          tx = dog.target.x;
          tz = dog.target.z;
          if ((tx - dog.x) ** 2 + (tz - dog.z) ** 2 < pr2) {
            dog.target.active = false;
            dog.target = null;
            dog.carry++; // 撿一片疊到背上
            sound.pickup();
            /** 背滿 carryMax 就送回攤位 */
            if (dog.carry >= CONFIG.dog.carryMax) dog.state = 'deliver';
          }
        } else if (dog.carry > 0) {
          /** 沒肉可撿了、但背上有貨：先送回攤位 */
          dog.state = 'deliver';
        } else {
          /** 空手又沒肉：在攤位旁待命 */
          tx = depotX + 2.2;
          tz = depotZ;
        }
      } else {
        tx = depotX;
        tz = depotZ;
        if ((tx - dog.x) ** 2 + (tz - dog.z) ** 2 < pr2 * 2) {
          /** 把整背的肉一次上架（飛行動畫取樣幾片即可，避免一次噴上百個） */
          counterMeat += dog.carry;
          const flies = Math.min(dog.carry, 8);
          for (let k = 0; k < flies; k++) {
            meatFly.spawn(
              dog.x,
              1.0 + k * 0.2,
              dog.z,
              CONFIG.counter.x + (Math.random() - 0.5) * 1.2,
              COUNTER_TOP_Y + 0.4,
              CONFIG.counter.z + (Math.random() - 0.5) * 0.6,
            );
          }
          dog.carry = 0;
          dog.state = 'seek';
          sound.place();
        }
      }
      const dx = tx - dog.x;
      const dz = tz - dog.z;
      const d = Math.hypot(dx, dz);
      const mv = d > 0.06;
      if (mv) {
        const step = Math.min(d, speed * dt);
        dog.x += (dx / d) * step;
        dog.z += (dz / d) * step;
        dog.root.rotation.y = Math.atan2(dx, dz);
      }
      dog.root.position.set(dog.x, dog.yOffset, dog.z);
      setDogAnim(dog, mv ? 'walk' : 'idle');
    }
  }

  /** 玩家背後（面向反方向）約胸高的位置 */
  function playerBack(): [number, number, number] {
    const yaw = player.rotation.y;
    const back = 1.0 * PLAYER_SCALE;
    return [player.position.x - Math.sin(yaw) * back, 1.5 * PLAYER_SCALE, player.position.z - Math.cos(yaw) * back];
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
    if (dogMeatStack) {
      const pos: Vector3[] = [];
      for (const dog of dogs) {
        if (dog.carry <= 0) continue;
        /** 疊在背上（往後一點），數量越多疊越高（同玩家背肉） */
        const yaw = dog.root.rotation.y;
        const bx = dog.x - Math.sin(yaw) * 0.15;
        const bz = dog.z - Math.cos(yaw) * 0.15;
        for (let k = 0; k < dog.carry; k++) {
          pos.push(new Vector3(bx, dog.yOffset + 0.7 + k * CONFIG.dog.carryStep, bz));
        }
      }
      dogMeatStack.layout(pos);
    }
    if (custMeatStack) {
      const pos: Vector3[] = [];
      for (const c of customers) {
        if (!c.root.isEnabled() || c.meatCount <= 0) continue;
        /** 沿顧客面向的前方捧著（往前移、離開臉部），多片往上疊 */
        const fx = Math.sin(c.root.rotation.y);
        const fz = Math.cos(c.root.rotation.y);
        const forward = 0.7;
        for (let k = 0; k < c.meatCount; k++) {
          pos.push(new Vector3(c.root.position.x + fx * forward, 0.95 + k * 0.17, c.root.position.z + fz * forward));
        }
      }
      custMeatStack.layout(pos);
    }
  }

  /** 把玩家限制在「店面 ∪ 牧場 ∪ 連通走廊（含解鎖後的牧場2）」範圍內 */
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
    /** 牧場2 與西側走道：買炸藥解鎖後才開放 */
    const P2 = CONFIG.pasture2;
    const inWestCorridor =
      pasture2Unlocked && p.x <= -a + 2 && p.x >= P2.cx + P2.halfX - 1.2 && p.z <= -4 && p.z >= -10;
    const inPasture2 =
      pasture2Unlocked &&
      p.x >= P2.cx - P2.halfX + 0.8 &&
      p.x <= P2.cx + P2.halfX - 0.8 &&
      p.z >= P2.cz - P2.halfZ + 0.8 &&
      p.z <= P2.cz + P2.halfZ - 0.8;
    if (inShop || inCorridor || inPasture || inWestCorridor || inPasture2) return;
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
      treeField?.dispose();
      dynamiteStation.dispose();
      pasture2Holder.dispose();
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
      dogs.forEach((d) => d.root.dispose());
      dogStation.dispose();
      hitFx.dispose();
      killFx.dispose();
      muzzleFx.dispose();
      sparkTex.dispose();
      weaponStations.forEach((ws) => ws.dispose());
      counterStack?.dispose();
      cashStack?.dispose();
      custMeatStack?.dispose();
      dropStack?.dispose();
      dogMeatStack?.dispose();
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
    setTreeCount(v: number) {
      treeVisible = Math.max(0, Math.min(TREE_MAX, Math.round(v)));
      applyTreeCount();
    },
    setMoney(v: number) {
      money = Math.max(0, v);
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

/**
 * 一段柵欄；horizontal = 沿 x 方向。parent 可掛在節點上一起開關。
 * 有 center 模型時用 Fence_Center 實例（沿 x，垂直牆轉 90°）；否則 fallback 程序化柱+橫桿。
 */
function fenceSeg(
  scene: Scene,
  center: Mesh | null,
  mat: StandardMaterial,
  x: number,
  z: number,
  horizontal: boolean,
  seg: number,
  parent?: TransformNode,
) {
  if (center) {
    const inst = center.createInstance('fence');
    inst.isPickable = false;
    inst.position.set(x, 0, z);
    inst.rotation.y = horizontal ? 0 : Math.PI / 2; // Center 預設沿 X；垂直牆轉 90°
    if (parent) inst.parent = parent;
    return;
  }
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
  if (parent) {
    post.parent = parent;
    rail.parent = parent;
  }
}

/** 店面圍場：+z 前門、-z 後門（往牧場1）、-x 西側左上留缺口（往牧場2 走道） */
function buildShopFence(scene: Scene, center: Mesh | null, wood: StandardMaterial, half = CONFIG.arenaHalf) {
  const seg = 2;
  for (let p = -half; p <= half; p += seg) {
    if (!(Math.abs(p) < 3)) fenceSeg(scene, center, wood, p, half, true, seg); // 前門缺口
    if (!(Math.abs(p) < 3)) fenceSeg(scene, center, wood, p, -half, true, seg); // 後門（往牧場1）缺口
    if (!(p <= -half + 4)) fenceSeg(scene, center, wood, -half, p, false, seg); // 西牆左上缺口（往牧場2）
    fenceSeg(scene, center, wood, half, p, false, seg);
  }
}

/** 牧場缺口設定：在某面牆（以中心座標 center、半寬 half）留通道 */
interface FenceGap {
  side: 'north' | 'south' | 'east' | 'west';
  center: number;
  half: number;
}

/** 牧場圍場（通用）：可指定區域、缺口、掛載節點（牧場2 掛 holder 以便整片開關） */
function buildPastureFence(
  scene: Scene,
  center: Mesh | null,
  wood: StandardMaterial,
  region: Region,
  gaps: FenceGap[] = [],
  parent?: TransformNode,
) {
  const { cx, cz, halfX, halfZ } = region;
  const seg = 2;
  const gapAt = (side: FenceGap['side'], coord: number) =>
    gaps.some((g) => g.side === side && Math.abs(coord - g.center) < g.half);
  for (let x = cx - halfX; x <= cx + halfX; x += seg) {
    if (!gapAt('north', x)) fenceSeg(scene, center, wood, x, cz - halfZ, true, seg, parent);
    if (!gapAt('south', x)) fenceSeg(scene, center, wood, x, cz + halfZ, true, seg, parent);
  }
  for (let z = cz - halfZ; z <= cz + halfZ; z += seg) {
    if (!gapAt('west', z)) fenceSeg(scene, center, wood, cx - halfX, z, false, seg, parent);
    if (!gapAt('east', z)) fenceSeg(scene, center, wood, cx + halfX, z, false, seg, parent);
  }
}

/** 浮空文字招牌；回傳 plane 以便掛到節點上一起開關 */
function makeSign(scene: Scene, text: string, x: number, y: number, z: number): Mesh {
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
  return plane;
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
    /** 繞 Y 轉 180°：否則從目前相機角度看，框內貼圖（武器圖示／價格／文字）會上下顛倒 */
    ground.rotation.y = Math.PI;
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

/** 通用購買框：地面白框＋emoji＋價格＋付款進度條，付滿後顯示完成字樣（炸藥／狗等共用） */
class BuyStation {
  private tex: DynamicTexture;
  private progress = 0;
  private done = false;
  private lastDraw = -2;

  constructor(
    scene: Scene,
    x: number,
    z: number,
    private cost: number,
    private emoji: string,
    private doneText: string,
  ) {
    const ground = MeshBuilder.CreateGround('dyn-zone', { width: 3.0, height: 3.0 }, scene);
    ground.position.set(x, 0.06, z);
    /** 同武器框：繞 Y 轉 180° 避免貼圖上下顛倒 */
    ground.rotation.y = Math.PI;
    ground.isPickable = false;
    this.tex = new DynamicTexture('dyn-zone-tex', { width: 256, height: 256 }, scene, false);
    const mat = new StandardMaterial('dyn-zone-mat', scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    ground.material = mat;
    this.redraw();
  }

  setProgress(r: number) {
    this.progress = Math.max(0, Math.min(1, r));
    if (Math.abs(this.progress - this.lastDraw) >= 0.02 || this.progress >= 1) this.redraw();
  }
  setDone() {
    if (this.done) return;
    this.done = true;
    this.progress = 1;
    this.redraw();
  }
  dispose() {
    this.tex.dispose();
  }

  private redraw() {
    this.lastDraw = this.progress;
    const ctx = this.tex.getContext() as CanvasRenderingContext2D;
    const W = 256;
    ctx.clearRect(0, 0, W, W);
    roundRect(ctx, 8, 8, W - 16, W - 16, 28);
    ctx.fillStyle = this.done ? 'rgba(22,90,50,0.82)' : 'rgba(46,24,18,0.8)';
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '104px sans-serif';
    ctx.fillText(this.emoji, W / 2, 84);
    if (this.done) {
      ctx.font = 'bold 36px sans-serif';
      ctx.fillStyle = '#9af0b0';
      ctx.fillText(this.doneText, W / 2, 178);
    } else {
      ctx.font = 'bold 54px sans-serif';
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(`💰${this.cost}`, W / 2, 162);
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

