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
  HighlightLayer,
} from '@babylonjs/core';
import { createTerrain } from './terrain';
import { loadCharacter, loadProp, loadAnimatedFleet, type AnimatedModel, type AnimatedFleet } from './model-loader';
import { BackStack } from './back-stack';
import { TreeField, type TreePlacement } from './tree-field';
import { FloatingText } from './floating-text';
import { unlockAchievement } from './achievements';
import { addTotals, submitRun, getName } from './community';
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
const CUSTOMER_MEAT = 10; // 每位顧客一次最多買/拿幾片肉（加倍）
const BRICK_SIZE = 1.5; // 房子院子紅磚塊邊長
const TURRET_AIM_OFFSET = 0; // 砲管朝向修正（若瞄準方向偏 90°/180°，改 ±Math.PI/2 或 Math.PI）
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

export interface NearInfoView {
  emoji: string;
  name: string;
  effect: string;
  hint: string;
}

export interface GameStats {
  fps: number;
  gameTime: number; // 遊戲進行秒數
  money: number;
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
  /** 玩家靠近的功能框說明（看不懂圖案時的提示卡），不在附近則 null */
  nearInfo: NearInfoView | null;
  /** 基地防禦戰：是否進行中、攻入數/上限、波次提示文字、勝負 */
  defenseActive: boolean;
  breaches: number;
  breachMax: number;
  wave: number; // 目前波數
  waveLabel: string;
  gameOver: boolean; // 失守（攻入達上限）
  won: boolean; // 通關
  /** 目前點選的塔（升級選單用），未選則 null */
  selectedTower: { type: string; level: number; maxLevel: number; cost: number; maxed: boolean; affordable: boolean; detail: string } | null;
  showDefenseIntro: boolean; // 剛買房子、待玩家確認開啟塔防
}

export interface GameOptions {
  onStats?: (s: GameStats) => void;
}

export interface GameHandle {
  dispose: () => void;
  setJoystick: (x: number, z: number) => void;
  setMuted: (on: boolean) => void;
  /** 畫質：設定算繪解析度倍率（1=最清晰；越大越省效能/越糊） */
  setHardwareScaling: (level: number) => void;
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
  /** 升級目前點選的塔 */
  upgradeSelectedTower: () => void;
  /** 取消選取塔（關閉選單） */
  deselectTower: () => void;
  /** 確認開啟塔防：1 分鐘後迎來第一波 */
  startDefense: () => void;
  /** Debug：直接跳到第 n 波（必要時先蓋好房子） */
  setWave: (n: number) => void;
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

/** 自動化員工（獵人＝自動打怪；收銀員＝自動收錢） */
interface Worker {
  role: 'hunt' | 'cash';
  root: TransformNode;
  idle?: AnimationGroup;
  walk?: AnimationGroup;
  attack?: AnimationGroup;
  animState: 'idle' | 'walk' | 'attack';
  baseScale: number;
  yOffset: number;
  x: number;
  z: number;
  target: Cow | null; // 獵人目標
  attackAccum: number; // 攻擊計時
  attackTimer: number; // 攻擊動畫殘留
}

/** 殭屍（防禦戰：從東門湧入、走向房子攻擊房子血量） */
interface Zombie {
  type: string; // 兵種
  isBoss: boolean;
  bar?: HpBar; // Boss 專屬血條
  root: TransformNode;
  idle?: AnimationGroup;
  walk?: AnimationGroup;
  attack?: AnimationGroup;
  death?: AnimationGroup;
  animState: 'idle' | 'walk' | 'attack' | 'death';
  baseScale: number;
  yOffset: number;
  x: number;
  z: number;
  hp: number;
  hpMax: number;
  baseHp: number; // 兵種基礎血（波次再加成）
  speed: number;
  dmg: number;
  reward: number;
  alive: boolean;
  active: boolean; // 是否在場上（從池中啟用）
  entered: boolean; // 是否已從東門進入院子（先走到門口，再走向房子）
  dying: number;
  attackAccum: number;
  slowT: number; // 緩速塔減速剩餘秒數（>0 表示移動減速中）
  slowFactor: number; // 當前減速倍率（越小越慢；塔等級越高越強）
  meshes: Mesh[]; // 身體網格（被減速時加入發光層）
  glowing: boolean; // 是否正在發藍光
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

  createTerrain(scene).freezeWorldMatrix(); // 靜態地面

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
    const center = await loadProp(scene, '/models/fence/Fence_Center.glb', 2.0);
    if (center) center.isVisible = false;
    buildShopFence(scene, center, wood);
    buildPastureFence(scene, center, wood, CONFIG.pasture, [{ side: 'south', center: CONFIG.pasture.cx, half: 3 }]);
    buildPastureFence(scene, center, wood, CONFIG.pasture2, [{ side: 'east', center: -7, half: 3 }], pasture2Holder);
  }
  void setupFences();

  /** ===== 炸藥購買框：站著付滿 💲500 即炸開牧場2 ===== */
  const dynamiteStation = new BuyStation(scene, CONFIG.dynamite.x, CONFIG.dynamite.z, CONFIG.dynamite.cost, '🧨', '炸藥', '炸開牧場2', '牧場2 已開通');
  let dynamitePaid = 0;
  let pasture2Unlocked = false;
  /** 爆炸時的畫面震動強度（1→0 衰減） */
  let camShake = 0;

  /** ===== 牧羊犬購買框：站著付滿 💲300 召喚一隻會自動撿肉的狗 ===== */
  const dogStation = new BuyStation(scene, CONFIG.dog.x, CONFIG.dog.z, CONFIG.dog.cost, '🐕', '牧羊犬', '自動撿肉回攤位', '已有狗狗幫手');
  let dogPaid = 0;
  let dogBought = false;
  const dogs: Dog[] = [];
  let dogFleet: AnimatedFleet | null = null;

  /** ===== 自動化員工：獵人（自動打怪）、收銀員（自動收錢） ===== */
  const hunterStation = new BuyStation(scene, CONFIG.hunter.x, CONFIG.hunter.z, CONFIG.hunter.cost, '🏹', '獵人', '自動打牛取肉', '已雇用獵人');
  const cashierStation = new BuyStation(scene, CONFIG.cashier.x, CONFIG.cashier.z, CONFIG.cashier.cost, '🧑‍💼', '收銀員', '自動收銀台的錢', '已雇用收銀員');
  let hunterPaid = 0;
  let hunterBought = false;
  let cashierPaid = 0;
  let cashierBought = false;
  const workers: Worker[] = [];
  let hunterFleet: AnimatedFleet | null = null;
  let cashierFleet: AnimatedFleet | null = null;

  /** ===== 房子（牧場2 對面，買下後炸地長出 + 紅磚圍牆院子） ===== */
  const houseStation = new BuyStation(scene, CONFIG.house.x, CONFIG.house.z, CONFIG.house.cost, '🛡️', '開啟塔防', '殭屍來襲守城', '已開啟塔防', true);
  let houseBought = false;

  /** 靠近功能框時顯示的說明（解決「看不懂地上圖案」） */
  const WEAPON_EFFECT: Record<string, string> = {
    sword: '快速橫掃，一次掃到多隻',
    axe: '攻擊時旋轉，打到周圍全部敵人',
    smg: '遠距離快速掃射',
  };
  const infoPoints: { x: number; z: number; emoji: string; name: string; effect: string; hint: string }[] = [
    { x: CONFIG.dynamite.x, z: CONFIG.dynamite.z, emoji: '🧨', name: '炸藥', effect: '炸開牧場2（出現肉×2、血×2 強化怪）', hint: '站著付款購買' },
    { x: CONFIG.dog.x, z: CONFIG.dog.z, emoji: '🐕', name: '牧羊犬', effect: '自動把地上的肉撿回攤位', hint: '站著付款購買' },
    { x: CONFIG.hunter.x, z: CONFIG.hunter.z, emoji: '🏹', name: '獵人', effect: '自動進牧場打牛取肉', hint: '站著付款購買' },
    { x: CONFIG.cashier.x, z: CONFIG.cashier.z, emoji: '🧑‍💼', name: '收銀員', effect: '自動收銀台的錢', hint: '站著付款購買' },
    { x: CONFIG.house.x, z: CONFIG.house.z, emoji: '🛡️', name: '開啟塔防', effect: '殭屍來襲，蓋塔守住基地圍欄', hint: '身上滿 $5000 自動開啟（不扣錢）' },
    ...WEAPONS.map((w) => ({ x: w.x, z: w.z, emoji: w.emoji, name: w.name, effect: WEAPON_EFFECT[w.id] ?? '', hint: '踩上去購買／切換' })),
    ...CONFIG.house.towerPads.map((p) => ({
      x: p.x,
      z: p.z,
      emoji: p.type === 'cannon' ? '💣' : p.type === 'slow' ? '❄️' : '🏹',
      name: p.type === 'cannon' ? '砲塔' : p.type === 'slow' ? '緩速塔' : '機槍塔',
      effect: p.type === 'cannon' ? '範圍爆擊，濺射傷害' : p.type === 'slow' ? '丟藍彈讓殭屍減速（無傷害）' : '單體快速射擊',
      hint: '站著付款蓋塔，點塔可升級',
    })),
  ];
  /** 紅磚圍牆＋塔位掛在此節點上，買下房子後一次顯示 */
  const houseHolder = new TransformNode('house-yard', scene);
  houseHolder.setEnabled(false);
  /** 每個塔位的浮空牌貼圖（可重畫更新等級/費用） */
  const towerSigns: DynamicTexture[] = [];
  const towerSignPlanes: Mesh[] = [];
  buildTowerPads(houseHolder);
  /** 基地圍欄警戒線：殭屍越過此紅色光牆＝攻入基地（掛在 houseHolder，開塔防時顯示，會脈動閃爍） */
  const breachLineMat = new StandardMaterial('breach-line-mat', scene);
  breachLineMat.emissiveColor = new Color3(1, 0.18, 0.18);
  breachLineMat.diffuseColor = Color3.Black();
  breachLineMat.specularColor = Color3.Black();
  breachLineMat.disableLighting = true;
  breachLineMat.alpha = 0.34;
  let breachPulseT = 0;
  {
    const y = CONFIG.house.yard;
    const wall = MeshBuilder.CreateBox('breach-line', { width: 0.5, height: 2.4, depth: y.maxZ - y.minZ }, scene);
    wall.position.set(y.minX, 1.2, (y.minZ + y.maxZ) / 2);
    wall.isPickable = false;
    wall.material = breachLineMat;
    wall.parent = houseHolder;
  }

  /** ===== 房子防禦戰狀態 ===== */
  const DEF = CONFIG.defense;
  /** 攻入基地的怪物數：達 BREACH_MAX 即遊戲結束 */
  let breaches = 0;
  const BREACH_MAX = 10;
  /** 越過此 x（往西）＝攻入原本基地的圍欄內 */
  const BASE_BREACH_X = CONFIG.house.yard.minX;
  /** 殭屍的進攻目標：原本基地中心 */
  const BASE_CX = 0;
  const BASE_CZ = -2;
  /** 波次：idle(未開始) / prep(準備) / active(交戰) / lost(失守) / won(通關) */
  let waveState: 'idle' | 'prep' | 'active' | 'lost' | 'won' = 'idle';
  let waveNum = 0;
  let waveTimer = 0; // prep 倒數
  let defenseIntroPending = false; // 剛開啟塔防，等玩家在說明視窗按確認才開打
  let zombiesToSpawn = 0; // 本波還要生成幾隻（一般）
  let bossToSpawn = 0; // 本波還要生成幾隻 Boss
  let zombieSpawnAccum = 0;
  const zombies: Zombie[] = [];
  const zombieFleets: AnimatedFleet[] = [];
  /** 塔來源 mesh（箭塔/砲塔）+ 各塔位狀態 */
  let towerSrc: Mesh | null = null;
  let cannonSrc: Mesh | null = null;
  let slowSrc: Mesh | null = null;
  /** 砲塔炸彈投射物（飛到目標才爆炸） */
  let bombSrc: Mesh | null = null;
  let slowBombSrc: Mesh | null = null;
  interface Bomb {
    inst: InstancedMesh;
    active: boolean;
    fx: number;
    fy: number;
    fz: number;
    tx: number;
    tz: number;
    t: number;
    dmg: number;
    slow: boolean; // true＝藍色緩速炸彈（不造成傷害，落點範圍減速）
    slowFactor: number; // 緩速倍率（隨塔等級更強）
    splash: number; // 爆炸/減速作用半徑
  }
  const bombs: Bomb[] = [];
  const towerPads = CONFIG.house.towerPads.map((p) => ({
    x: p.x,
    z: p.z,
    type: p.type,
    paid: 0,
    built: false,
    level: 0,
    fireAccum: 0,
    inst: null as InstancedMesh | null,
    pips: [] as Mesh[], // 頭頂等級圓點
  }));
  /** 等級圓點共用材質（金色發光） */
  const pipMat = new StandardMaterial('pip-mat', scene);
  pipMat.emissiveColor = new Color3(1, 0.85, 0.2);
  pipMat.diffuseColor = Color3.Black();
  pipMat.specularColor = Color3.Black();
  pipMat.disableLighting = true;
  /** 被減速殭屍的藍色身體發光（HighlightLayer，沿輪廓發藍光） */
  const slowGlow = new HighlightLayer('slowGlow', scene);
  slowGlow.innerGlow = true;
  slowGlow.outerGlow = true;
  const SLOW_GLOW_COLOR = new Color3(0.25, 0.7, 1);
  /** 依塔種取設定（箭/砲/緩速） */
  const towerCfgOf = (type: string) => (type === 'cannon' ? DEF.cannon : type === 'slow' ? DEF.slow : DEF.tower);
  /** 塔的有效射程（隨等級提升 15%/級） */
  const towerRange = (pad: (typeof towerPads)[number]) => towerCfgOf(pad.type).range * (1 + (pad.level - 1) * 0.15);
  /** 重建塔頭頂的等級圓點（數量＝等級） */
  function setTowerPips(i: number) {
    const pad = towerPads[i];
    pad.pips.forEach((m) => m.dispose());
    pad.pips = [];
    /** 依塔目前縮放決定頂端高度：等級點貼著塔頂、說明牌再更上面（不卡素材） */
    const scale = pad.inst?.scaling.x ?? 1;
    const top = towerCfgOf(pad.type).size * scale;
    const plane = towerSignPlanes[i];
    if (plane) plane.position.y = top + 2.2;
    const topY = top + 0.9;
    for (let k = 0; k < pad.level; k++) {
      const s = MeshBuilder.CreateSphere('pip', { diameter: 0.55, segments: 8 }, scene);
      s.material = pipMat;
      s.isPickable = false;
      s.position.set(pad.x + (k - (pad.level - 1) / 2) * 0.7, topY, pad.z);
      s.parent = houseHolder;
      pad.pips.push(s);
    }
  }
  /** 塔升級到第 lvl 級的花費（lvl 從 1 起） */
  const towerUpgradeCost = (type: string, lvl: number) =>
    Math.floor(towerCfgOf(type).cost * 0.8 * Math.pow(1.7, lvl));
  /** 塔位牌依狀態重畫 */
  function refreshTowerSign(i: number) {
    const pad = towerPads[i];
    const tex = towerSigns[i];
    if (!tex) return;
    const emoji = pad.type === 'cannon' ? '💣' : pad.type === 'slow' ? '❄️' : '🏹';
    if (!pad.built) {
      drawTowerSign(tex, emoji, `$${towerCfgOf(pad.type).cost}`);
    } else if (pad.level >= DEF.towerMaxLevel) {
      drawTowerSign(tex, emoji, `Lv.${pad.level} MAX`, '#9af0b0');
    } else {
      drawTowerSign(tex, emoji, `Lv.${pad.level} ↑$${towerUpgradeCost(pad.type, pad.level + 1)}`, '#cfe6ff');
    }
  }
  /** 塔射擊用的細線 tracer 池 */
  const towerTracers = Array.from({ length: 10 }, (_, i) => {
    const t = MeshBuilder.CreateBox(`ttr${i}`, { width: 0.12, height: 0.12, depth: 1 }, scene);
    const m = new StandardMaterial(`ttr-mat${i}`, scene);
    m.emissiveColor = new Color3(0.6, 0.95, 1);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    t.material = m;
    t.isPickable = false;
    t.setEnabled(false);
    return { mesh: t, life: 0 };
  });
  let tracerCursor = 0;
  /** 射程指示圈：點到塔時顯示該塔射程範圍 */
  const rangeRing = MeshBuilder.CreateDisc('range-ring', { radius: 1, tessellation: 48 }, scene);
  rangeRing.rotation.x = Math.PI / 2;
  rangeRing.isPickable = false;
  const rrMat = new StandardMaterial('range-ring-mat', scene);
  rrMat.emissiveColor = new Color3(0.3, 0.8, 1);
  rrMat.diffuseColor = Color3.Black();
  rrMat.specularColor = Color3.Black();
  rrMat.disableLighting = true;
  rrMat.alpha = 0.16;
  rrMat.backFaceCulling = false;
  rangeRing.material = rrMat;
  rangeRing.setEnabled(false);
  /** 目前選取的塔位（點塔開升級選單用）；-1 = 未選 */
  let selectedPad = -1;
  /** 點擊：算出地面點，選取最近的已蓋塔（顯示射程圈 + 升級選單），點空白處取消 */
  const onTowerPick = () => {
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, null, camera);
    if (Math.abs(ray.direction.y) < 1e-4) return;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return;
    const px = ray.origin.x + ray.direction.x * t;
    const pz = ray.origin.z + ray.direction.z * t;
    let bi = -1;
    let bd = 9; // 點擊容差半徑 3
    for (let i = 0; i < towerPads.length; i++) {
      const pad = towerPads[i];
      if (!pad.built) continue;
      const q = (pad.x - px) ** 2 + (pad.z - pz) ** 2;
      if (q < bd) {
        bd = q;
        bi = i;
      }
    }
    selectedPad = bi;
    if (bi >= 0) {
      const pad = towerPads[bi];
      rangeRing.position.set(pad.x, 0.12, pad.z);
      rangeRing.scaling.setAll(towerRange(pad));
      rangeRing.setEnabled(true);
    } else {
      rangeRing.setEnabled(false);
    }
  };
  canvas.addEventListener('pointerdown', onTowerPick);
  /** 升級目前選取的塔（由選單按鈕呼叫，整筆扣款、即時升級） */
  function doUpgradeTower() {
    if (selectedPad < 0) return;
    const pad = towerPads[selectedPad];
    if (!pad.built || pad.level >= DEF.towerMaxLevel) return;
    const cost = towerUpgradeCost(pad.type, pad.level + 1);
    if (money < cost) return;
    money -= cost;
    pad.level++;
    pad.inst?.scaling.setAll(1 + pad.level * 0.24); // 升級放大比例加倍
    setTowerPips(selectedPad);
    /** 升級特效：金色火花爆發 + 文字 */
    burstAt(killFx, pad.x, 2.5, pad.z, 18);
    burstAt(muzzleFx, pad.x, 3.5, pad.z, 14);
    floatText.spawn(`Lv.${pad.level}!`, pad.x, 4.2, pad.z, '#9af0b0', 1.4);
    refreshTowerSign(selectedPad);
    /** 升級後若仍選取中，射程圈同步放大 */
    rangeRing.scaling.setAll(towerRange(pad));
    sound.upgrade();
  }

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

  /** 地面血漬池（牛死亡血痕；玩家血量設計已取消） */
  const bloodDecals = new BloodDecals(scene);

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
  /** 藍色冰霜爆裂（緩速炸彈命中用）：偏青白、向外四散、發光 */
  const frostFx = makeBurst('frostfx', new Color4(0.75, 0.95, 1, 1), new Color4(0.2, 0.55, 1, 1), 0.18, 0.7, 0.55, 7, true);
  /** 藍色冰霜地痕池：緩速炸彈落點短暫顯示一圈（標示減速範圍）後淡出 */
  const frostPatchMat = new StandardMaterial('frost-patch-mat', scene);
  frostPatchMat.emissiveColor = new Color3(0.4, 0.8, 1);
  frostPatchMat.diffuseColor = Color3.Black();
  frostPatchMat.specularColor = Color3.Black();
  frostPatchMat.disableLighting = true;
  const FROST_PATCH_LIFE = 1.6;
  const frostPatches = Array.from({ length: 10 }, (_, i) => {
    const d = MeshBuilder.CreateDisc(`frostpatch${i}`, { radius: DEF.slow.splash, tessellation: 24 }, scene);
    d.rotation.x = Math.PI / 2;
    d.material = frostPatchMat;
    d.isPickable = false;
    d.visibility = 0;
    d.setEnabled(false);
    return { mesh: d, life: 0 };
  });
  let frostPatchCursor = 0;
  function spawnFrostPatch(x: number, z: number) {
    const p = frostPatches[frostPatchCursor];
    frostPatchCursor = (frostPatchCursor + 1) % frostPatches.length;
    p.life = FROST_PATCH_LIFE;
    p.mesh.position.set(x, 0.06, z);
    p.mesh.visibility = 0.55;
    p.mesh.setEnabled(true);
  }
  function updateFrostPatches(dt: number) {
    for (const p of frostPatches) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.setEnabled(false);
        p.mesh.visibility = 0;
      } else {
        p.mesh.visibility = 0.55 * (p.life / FROST_PATCH_LIFE);
      }
    }
  }
  /** 漂浮數字（+$／傷害） */
  const floatText = new FloatingText(scene);
  /** 效能：傷害數字節流（解析度改由玩家在上方下拉選單手動選） */
  let dmgNumThisFrame = 0;
  const DMG_NUM_CAP = 4; // 每幀最多冒幾個傷害數字（迴旋斧一次打全部時不會噴一堆）
  const dmgNumber = (text: string, x: number, z: number) => {
    if (dmgNumThisFrame >= DMG_NUM_CAP) return;
    dmgNumThisFrame++;
    floatText.spawn(text, x, 2.6, z, '#ffffff', 0.8);
  };
  /** ===== 社群統計累計（每幾秒把增量寫進 localStorage 總計 + 更新排行榜） ===== */
  let pendMoney = 0; // 待寫入的「賺錢」增量
  let pendCows = 0; // 待寫入的殺牛增量
  let pendZombies = 0; // 待寫入的殺怪增量
  let sessionMoney = 0; // 本場累計賺錢（排行榜用）
  let bestWaveReached = 0; // 本場最高波數
  let submittedWave = -1; // 已上榜的波數
  let statsRunCounted = false; // 本場是否已計入場次
  let statFlushT = 0;
  const earn = (v: number) => {
    pendMoney += v;
    sessionMoney += v;
    if (sessionMoney >= 2000) achieve('rich'); // 累積賺到 $2000
  };

  /** 成就：本場已解鎖（避免重複寫 localStorage），首次解鎖時冒提示 */
  const unlockedLocal = new Set<string>();
  const achieve = (id: string) => {
    if (unlockedLocal.has(id)) return;
    unlockedLocal.add(id);
    if (unlockAchievement(id)) floatText.spawn('🏅 成就解鎖！', player.position.x, 4, player.position.z, '#ffe066', 1.6);
  };
  /** 收錢漂浮數字節流累計（避免每根金條都冒一個） */
  let collectShowSum = 0;
  let collectShowAccum = 0;
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
  /** 招攬客流升級：等級越高，顧客生成越快、同場上限越多 */
  const flowLevel = () => levels['flow'] ?? 0;
  const spawnInterval = () => CONFIG.customer.spawnSec / (1 + flowLevel() * 0.35);
  const maxCustomers = () => Math.min(CONFIG.customer.max, 12 + flowLevel() * 1);
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
    const [tA, tB, tC] = await Promise.all([
      loadProp(scene, '/models/nature/Tree_4_A_Color1.glb', 3.6),
      loadProp(scene, '/models/nature/Tree_4_B_Color1.glb', 3.6),
      loadProp(scene, '/models/nature/Tree_4_C_Color1.glb', 3.6),
    ]);
    const trees = [tA, tB, tC].filter((m): m is Mesh => !!m);
    const RANGE = CONFIG.arenaHalf * 3.6; // 散布半徑（落在地面範圍內）

    /** 草素材已移除 */

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
    const [meatMesh, barMesh, cowFleet, makoFleet, dogFleetLoaded, hunterFleetLoaded, cashierFleetLoaded, hero, cf1, cf2, cm1, cm2] =
      await Promise.all([
      loadProp(scene, '/models/winter/meat.glb', MEAT_SIZE),
      loadProp(scene, '/models/winter/gold_bar.glb', BAR_SIZE),
      loadAnimatedFleet(scene, '/models/cow_animated.glb', CONFIG.cow.size),
      /** 牧場2 怪物：殭屍/海盜 Mako（含 Idle/Walk/Death 動畫） */
      loadAnimatedFleet(scene, '/models/enemies/Characters_Mako.glb', CONFIG.cow.size),
      /** 牧羊犬（含 Idle/Walk/Run 動畫） */
      loadAnimatedFleet(scene, '/models/Characters_GermanShepherd.glb', CONFIG.dog.size),
      /** 員工：獵人(Henry)／收銀員(Anne)，含 Idle/Walk/Sword 動畫 */
      loadAnimatedFleet(scene, '/models/Characters_Henry.glb', CONFIG.hunter.size),
      /** 收銀員：壽司兔（含 Idle/Walk/Idle_Holding 等動作） */
      loadAnimatedFleet(scene, '/models/Rabbit_Pink.glb', CONFIG.cashier.size),
      loadCharacter(scene, '/models/Characters_Shaun_SingleWeapon.glb', CONFIG.player.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Female_1.glb', CONFIG.customer.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Female_2.glb', CONFIG.customer.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Male_1.glb', CONFIG.customer.height),
      loadAnimatedFleet(scene, '/models/customers/Character_Male_2.glb', CONFIG.customer.height),
    ]);
    dogFleet = dogFleetLoaded;
    hunterFleet = hunterFleetLoaded;
    cashierFleet = cashierFleetLoaded;
    /** 場外北極熊（純氣氛，立在牧場後方） */
    void loadProp(scene, '/models/winter/polar_bear.glb', 3.4).then((b) => {
      if (b) b.position.set(-12, 0, P.cz - P.halfZ - 6);
    });
    /** （房子已移除：改為「殭屍攻入基地」判定，不再放置房屋模型） */
    /** 紅磚圍牆：沿院子周邊砌兩層磚（西側留缺口對齊走道），掛在 houseHolder 上 */
    void loadProp(scene, '/models/bricks_red.glb', BRICK_SIZE).then((b) => {
      if (b) {
        b.isVisible = false;
        buildBrickYard(b, houseHolder);
      }
    });
    /** 殭屍池改為「開啟塔防時才建」（buildZombiePool），避免進場就實例化整批，載入更快 */
    /** 塔模型來源：箭塔（Gatling 砲塔）/ 砲塔 */
    void loadProp(scene, '/models/gatling_turret.glb', DEF.tower.size).then((m) => {
      if (m) {
        m.isVisible = false;
        towerSrc = m;
      }
    });
    void loadProp(scene, '/models/flamethrower_turret.glb', DEF.cannon.size).then((m) => {
      if (m) {
        m.isVisible = false;
        cannonSrc = m;
      }
    });
    void loadProp(scene, '/models/tower_blue.glb', DEF.slow.size).then((m) => {
      if (m) {
        m.isVisible = false;
        slowSrc = m;
      }
    });
    /** 砲塔炸彈投射物池 */
    void loadProp(scene, '/models/prop_bomb.glb', 1.3).then((m) => {
      if (!m) return;
      m.isVisible = false;
      bombSrc = m;
      for (let i = 0; i < 10; i++) {
        const inst = m.createInstance(`bomb${i}`);
        inst.isPickable = false;
        inst.setEnabled(false);
        bombs.push({ inst, active: false, fx: 0, fy: 0, fz: 0, tx: 0, tz: 0, t: 0, dmg: 0, slow: false, slowFactor: 1, splash: DEF.cannon.splash });
      }
      /** 藍色緩速炸彈（複製模型 + 藍色發光材質） */
      const blue = m.clone('slow-bomb-src');
      if (blue) {
        blue.isVisible = false;
        const bm = new StandardMaterial('slow-bomb-mat', scene);
        bm.emissiveColor = new Color3(0.3, 0.7, 1);
        bm.diffuseColor = new Color3(0.15, 0.45, 0.85);
        bm.specularColor = Color3.Black();
        blue.material = bm;
        slowBombSrc = blue;
        for (let i = 0; i < 8; i++) {
          const inst = blue.createInstance(`sbomb${i}`);
          inst.isPickable = false;
          inst.setEnabled(false);
          bombs.push({ inst, active: false, fx: 0, fy: 0, fz: 0, tx: 0, tz: 0, t: 0, dmg: 0, slow: true, slowFactor: 1, splash: DEF.slow.splash });
        }
      }
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
    dmgNumThisFrame = 0; // 每幀重設傷害數字配額

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
            /** 接觸：只播放頂角攻擊動作（玩家不再扣血/被擊退） */
            c.lunge = 1;
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
        const dmg = Math.round(attackDamage());
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
            floatText.spawn(`+${c.meatYield}🥩`, c.x, 2.6, c.z, '#ffcf4a', 1.1); // 擊殺掉肉提示
            for (let k = 0; k < c.meatYield; k++) {
              spawnDrop(c.x + (Math.random() - 0.5) * 1.2, c.z + (Math.random() - 0.5) * 1.2);
            }
            pendCows++;
            anyKill = true;
          } else {
            burstAt(hitFx, c.x, 1.2, c.z, 14); // 命中火花
            dmgNumber(`${dmg}`, c.x, c.z); // 傷害數字（節流）
            anyHit = true;
          }
        }
        if (anyKill) sound.kill();
        else if (anyHit && !wpn.ranged) sound.hit(); // 近戰命中打擊聲（槍靠 shoot() 已有回饋，避免連發吵雜）
      } else {
        /** 範圍內沒有牛 → 改打殭屍（玩家幫忙守家） */
        const zlist: { z: Zombie; d: number }[] = [];
        for (const z of zombies) {
          if (!z.active || !z.alive) continue;
          const dx = z.x - player.position.x;
          const dz = z.z - player.position.z;
          const dd = dx * dx + dz * dz;
          if (dd < r2) zlist.push({ z, d: dd });
        }
        if (zlist.length) {
          zlist.sort((a, b) => a.d - b.d);
          const zt = zlist.slice(0, wpn.cleave);
          attackAccum = 0;
          playerAttackTimer = Math.max(0.25, wpn.interval);
          const f = zt[0].z;
          faceAngle = Math.atan2(f.x - player.position.x, f.z - player.position.z);
          if (wpn.ranged) {
            recoilT = 1;
            const barrel = playerModel?.builtinWeapon?.getAbsolutePosition() ?? weaponHolder.getAbsolutePosition();
            fireTracer(barrel, f.x, 1.2, f.z);
            sound.shoot();
          } else {
            swingT = 1;
            sound.swing();
          }
          for (const { z } of zt) damageZombie(z, attackDamage());
        }
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
        collectShowSum += v; // 累計，節流冒 +$
        earn(v);
        spawnCollectFly(); // 金條飛回背後動畫（背上根數由 money 換算）
        sound.cash();
      }
    } else cashAccum = 0.05;
    /** 收錢漂浮數字：每 0.35s 把累計金額冒一個 +$（避免每根都冒太吵） */
    collectShowAccum += dt;
    if (collectShowSum > 0 && collectShowAccum >= 0.35) {
      floatText.spawn(`+$${collectShowSum}`, player.position.x, CONFIG.player.height * PLAYER_SCALE + 0.4, player.position.z, '#ffe066', 1.1);
      collectShowSum = 0;
      collectShowAccum = 0;
    }

    /** --- 飛行物件更新（金條收錢/付款、肉擺攤）+ 漂浮數字 --- */
    goldFly.update(dt);
    meatFly.update(dt);
    floatText.update(dt);

    /** --- 靠近功能框 → 說明卡（解決看不懂地上圖案） --- */
    let nearInfoView: NearInfoView | null = null;
    {
      let bestD = 2.4 * 2.4;
      for (const ip of infoPoints) {
        const q = (player.position.x - ip.x) ** 2 + (player.position.z - ip.z) ** 2;
        if (q < bestD) {
          bestD = q;
          nearInfoView = { emoji: ip.emoji, name: ip.name, effect: ip.effect, hint: ip.hint };
        }
      }
    }

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
          achieve('dog');
          sound.upgrade();
        }
      }
    }

    /** --- 獵人框：付滿雇用一名自動打怪的獵人 --- */
    if (!hunterBought) {
      const H = CONFIG.hunter;
      if (near(H.x, H.z, 2.0) && money > 0) {
        const pay = Math.min(H.cost - hunterPaid, money, (H.cost / WEAPON_BUY_TIME) * dt);
        if (pay > 0) {
          hunterPaid += pay;
          money -= pay;
          payFlyAccum += pay;
          while (payFlyAccum >= PAY_PER_BAR) {
            payFlyAccum -= PAY_PER_BAR;
            spawnPayFly(H.x, H.z);
          }
        }
        hunterStation.setProgress(H.cost > 0 ? hunterPaid / H.cost : 1);
        if (hunterPaid >= H.cost - 0.001) {
          hunterBought = true;
          hunterStation.setDone();
          if (hunterFleet) spawnWorker(hunterFleet, 'hunt');
          achieve('hunter');
          sound.upgrade();
        }
      }
    }

    /** --- 收銀員框：付滿雇用一名自動收錢的收銀員 --- */
    if (!cashierBought) {
      const K = CONFIG.cashier;
      if (near(K.x, K.z, 2.0) && money > 0) {
        const pay = Math.min(K.cost - cashierPaid, money, (K.cost / WEAPON_BUY_TIME) * dt);
        if (pay > 0) {
          cashierPaid += pay;
          money -= pay;
          payFlyAccum += pay;
          while (payFlyAccum >= PAY_PER_BAR) {
            payFlyAccum -= PAY_PER_BAR;
            spawnPayFly(K.x, K.z);
          }
        }
        cashierStation.setProgress(K.cost > 0 ? cashierPaid / K.cost : 1);
        if (cashierPaid >= K.cost - 0.001) {
          cashierBought = true;
          cashierStation.setDone();
          if (cashierFleet) spawnWorker(cashierFleet, 'cash');
          achieve('cashier');
          sound.upgrade();
        }
      }
    }

    /** --- 房子框：付滿在東側炸地長出一棟房子 --- */
    if (!houseBought) {
      const Hs = CONFIG.house;
      if (near(Hs.x, Hs.z, 2.0)) {
        /** 不扣錢：身上累積到門檻（$5000）即可開啟塔防；進度條顯示存錢進度 */
        houseStation.setProgress(money / Hs.cost);
        if (money >= Hs.cost) {
          houseBought = true;
          houseStation.setDone();
          revealHouse();
          sound.upgrade();
        }
      }
    }

    /** --- 牧羊犬／員工／防禦戰 --- */
    updateDogs(dt);
    updateWorkers(dt);
    updateDefense(dt);

    /** --- 顧客生成 --- */
    spawnAccum += dt;
    const active = customers.filter((c) => c.root.isEnabled());
    if (spawnAccum >= spawnInterval() && active.length < maxCustomers()) {
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
          /** 成交：顧客頭上冒 +$ */
          floatText.spawn(`+$${price() * take}`, c.root.position.x, CONFIG.customer.height + 1.0, c.root.position.z, '#7cf08a', 1.0);
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
          achieve('sell');
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

    /** 社群統計：每 4 秒把增量寫進 localStorage 總計、更新本機排行榜 */
    statFlushT += dt;
    if (statFlushT >= 4) {
      statFlushT = 0;
      if (pendMoney > 0 || pendCows > 0 || pendZombies > 0) {
        addTotals({ money: Math.round(pendMoney), cows: pendCows, monsters: pendZombies, runs: statsRunCounted ? 0 : 1 });
        statsRunCounted = true;
        pendMoney = 0;
        pendCows = 0;
        pendZombies = 0;
      }
      if (bestWaveReached > submittedWave) {
        submittedWave = bestWaveReached;
        submitRun({ name: getName(), wave: bestWaveReached, money: Math.round(sessionMoney), won: waveState === 'won', at: Date.now() });
      }
    }

    statAccum += dt;
    if (statAccum >= 0.1) {
      statAccum = 0;
      options.onStats?.({
        fps: Math.round(engine.getFps()),
        gameTime: elapsed,
        money: Math.floor(money),
        carried,
        carryCap: carryCap(),
        counterMeat,
        counterCap: counterCap(),
        cashPending: Math.floor(cashPending),
        customers: active.length,
        weaponEmoji: WEAPONS[equipped].emoji,
        weaponName: WEAPONS[equipped].name,
        nearUpgrade: nearUp,
        nearInfo: nearInfoView,
        defenseActive: waveState !== 'idle',
        breaches,
        breachMax: BREACH_MAX,
        wave: waveNum,
        gameOver: waveState === 'lost',
        won: waveState === 'won',
        waveLabel:
          waveState === 'won'
            ? '🏆 通關！撐過 30 波'
            : waveState === 'lost'
              ? '💀 基地失守！'
              : waveState === 'prep'
              ? `🛡️ 準備中 ${Math.ceil(Math.max(0, waveTimer))}s（下一波 第${waveNum + 1}波）`
              : waveState === 'active'
                ? `🧟 第 ${waveNum} 波　剩 ${zombies.filter((z) => z.active).length + zombiesToSpawn + bossToSpawn}${bossToSpawn || zombies.some((z) => z.active && z.isBoss) ? ' 👹' : ''}`
                : '',
        selectedTower:
          selectedPad >= 0 && towerPads[selectedPad]?.built
            ? (() => {
                const pad = towerPads[selectedPad];
                const maxed = pad.level >= DEF.towerMaxLevel;
                const cost = maxed ? 0 : towerUpgradeCost(pad.type, pad.level + 1);
                /** 目前數值：緩速塔顯示減速%、其餘顯示一次幾發 */
                const detail =
                  pad.type === 'slow'
                    ? `減速 ${Math.round((1 - Math.max(0.15, DEF.slow.slowFactor - (pad.level - 1) * 0.05)) * 100)}%`
                    : `一次 ${Math.max(1, pad.level - 1)} 發`;
                return { type: pad.type, level: pad.level, maxLevel: DEF.towerMaxLevel, cost, maxed, affordable: money >= cost, detail };
              })()
            : null,
        showDefenseIntro: defenseIntroPending,
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
    achieve('pasture2');
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

  /** 沿院子周邊砌兩層紅磚（西側留缺口對齊走道），掛在 houseHolder 上 */
  function buildBrickYard(brick: Mesh, parent: TransformNode) {
    const { minX, maxX, minZ, maxZ } = CONFIG.house.yard;
    const put = (x: number, z: number) => {
      for (let r = 0; r < 2; r++) {
        const inst = brick.createInstance('brick');
        inst.isPickable = false;
        inst.position.set(x, r * BRICK_SIZE, z);
        inst.parent = parent;
        inst.freezeWorldMatrix(); // 靜態牆，凍結省每幀矩陣計算
      }
    };
    const westGap = (z: number) => z >= -10 && z <= -4; // 西牆：對齊店面東門走道（玩家進出）
    for (let x = minX; x <= maxX + 0.01; x += BRICK_SIZE) {
      put(x, minZ); // 北牆
      put(x, maxZ); // 南牆
    }
    for (let z = minZ + BRICK_SIZE; z <= maxZ - BRICK_SIZE + 0.01; z += BRICK_SIZE) {
      if (!westGap(z)) put(minX, z); // 西牆（留玩家入口）
      // 東牆（面向殭屍）整面拆除，殭屍直接從東側湧入
    }
  }

  /** 院子四角的塔位標記（藍色地墊 + 🏹 浮空牌）；塔機制之後接這些座標 */
  function buildTowerPads(parent: TransformNode) {
    for (const pad of CONFIG.house.towerPads) {
      const disc = MeshBuilder.CreateDisc('tower-pad', { radius: 1.7, tessellation: 28 }, scene);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(pad.x, 0.05, pad.z);
      disc.isPickable = false;
      const mat = new StandardMaterial('tower-pad-mat', scene);
      mat.diffuseColor = new Color3(0.4, 0.7, 0.95);
      mat.emissiveColor = new Color3(0.15, 0.3, 0.45);
      mat.specularColor = Color3.Black();
      disc.material = mat;
      disc.parent = parent;
      /** 浮空牌（動態貼圖，之後可重畫顯示等級/費用） */
      const tex = new DynamicTexture('tpad-tex', { width: 256, height: 140 }, scene, false);
      const plane = MeshBuilder.CreatePlane('tpad-sign', { width: 2.6, height: 1.4 }, scene);
      /** 牌子放在塔頂上方（依塔種高度），避免卡進模型 */
      const baseSize =
        pad.type === 'cannon' ? CONFIG.defense.cannon.size : pad.type === 'slow' ? CONFIG.defense.slow.size : CONFIG.defense.tower.size;
      plane.position.set(pad.x, baseSize + 1.6, pad.z);
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.isPickable = false;
      plane.parent = parent;
      towerSignPlanes.push(plane);
      const smat = new StandardMaterial('tpad-sign-mat', scene);
      smat.diffuseTexture = tex;
      smat.emissiveTexture = tex;
      smat.emissiveColor = new Color3(1, 1, 1);
      smat.diffuseColor = Color3.Black();
      smat.specularColor = Color3.Black();
      smat.disableLighting = true;
      smat.useAlphaFromDiffuseTexture = true;
      smat.backFaceCulling = false;
      plane.material = smat;
      towerSigns.push(tex);
      drawTowerSign(tex, pad.type === 'cannon' ? '💣' : '🏹', `$${pad.type === 'cannon' ? CONFIG.defense.cannon.cost : CONFIG.defense.tower.cost}`);
    }
  }

  /** 殭屍池：開啟塔防時才 instantiate（每種兵種一批，平時停用、開波啟用），避免進場就建整批 */
  let zombiePoolBuilt = false;
  function buildZombiePool() {
    if (zombiePoolBuilt) return;
    zombiePoolBuilt = true;
    for (const [type, cfg] of Object.entries(DEF.zombieTypes)) {
      void loadAnimatedFleet(scene, cfg.model, cfg.size).then((fl) => {
        if (!fl) return;
        zombieFleets.push(fl);
        for (let i = 0; i < cfg.pool; i++) {
          const ent = fl.container.instantiateModelsToScene((n) => `zb_${type}${i}_${n}`, false);
          const holder = new TransformNode(`zombie_${type}${i}`, scene);
          (ent.rootNodes[0] as TransformNode).parent = holder;
          holder.scaling.setAll(fl.scale);
          holder.setEnabled(false);
          ent.rootNodes.forEach((n) => (n as TransformNode).getChildMeshes?.().forEach((m) => (m.isPickable = false)));
          const g = ent.animationGroups;
          g.forEach((ag) => ag.stop());
          const walk = g.find((ag) => /^walk$/i.test(ag.name)) ?? g.find((ag) => /walk|run/i.test(ag.name));
          const idle = g.find((ag) => /^idle$/i.test(ag.name)) ?? g[0];
          const attack = g.find((ag) => /idle_attack|attack|punch|bite|sword|slash/i.test(ag.name));
          const death = g.find((ag) => /death|die/i.test(ag.name));
          const isBoss = type === 'boss';
          const bar = new HpBar(scene, isBoss ? 4 : 1.6, isBoss ? 0.5 : 0.26);
          bar.setEnabled(false);
          const zMeshes: Mesh[] = [];
          ent.rootNodes.forEach((n) =>
            (n as TransformNode).getChildMeshes?.().forEach((mm) => {
              if (mm instanceof Mesh) zMeshes.push(mm);
            }),
          );
          zombies.push({
            meshes: zMeshes,
            glowing: false,
            type,
            isBoss,
            bar,
            root: holder,
            idle,
            walk,
            attack,
            death,
            animState: 'idle',
            baseScale: fl.scale,
            yOffset: fl.yOffset,
            x: 0,
            z: 0,
            hp: 0,
            hpMax: 0,
            baseHp: cfg.hp,
            speed: cfg.speed,
            dmg: cfg.dmg,
            reward: cfg.reward,
            alive: false,
            active: false,
            entered: false,
            dying: 0,
            attackAccum: 0,
            slowT: 0,
            slowFactor: 1,
          });
        }
      });
    }
  }

  /** 開啟塔防：炸開東側樹林、顯示防禦院子（紅磚牆 + 塔位），並建立殭屍池 */
  function revealHouse() {
    const H = CONFIG.house;
    const y = H.yard;
    treeField?.hideRegion(y.minX - 2, y.maxX + 2, y.minZ - 2, y.maxZ + 2);
    houseHolder.setEnabled(true);
    buildZombiePool(); // 此時才實例化殭屍（有 60s 準備期可載入）
    spawnExplosion(H.hx, 1.6, H.hz);
    spawnExplosion(H.hx - 3, 1.4, H.hz + 3);
    camShake = 1;
    sound.boom();
    achieve('house');
    /** 不立刻開打：跳出說明視窗，待玩家確認（startDefense）後 1 分鐘迎來第一波 */
    breaches = 0;
    defenseIntroPending = true;
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

  /** 切換員工動畫（idle/walk/attack） */
  function setWorkerAnim(w: Worker, state: 'idle' | 'walk' | 'attack') {
    if (w.animState === state) return;
    w.animState = state;
    w.idle?.stop();
    w.walk?.stop();
    w.attack?.stop();
    if (state === 'walk') w.walk?.start(true);
    else if (state === 'attack') w.attack?.start(true);
    else w.idle?.start(true);
  }

  /** 雇用一名員工（從對應 fleet 複製一份帶動畫副本） */
  function spawnWorker(fleet: AnimatedFleet, role: 'hunt' | 'cash') {
    const i = workers.length;
    const ent = fleet.container.instantiateModelsToScene((n) => `wk${role}${i}_${n}`, false);
    const holder = new TransformNode(`worker_${role}${i}`, scene);
    (ent.rootNodes[0] as TransformNode).parent = holder;
    holder.scaling.setAll(fleet.scale);
    ent.rootNodes.forEach((n) => (n as TransformNode).getChildMeshes?.().forEach((m) => (m.isPickable = false)));
    const g = ent.animationGroups;
    g.forEach((ag) => ag.stop());
    const walk = g.find((ag) => /^walk$/i.test(ag.name)) ?? g.find((ag) => /walk|run/i.test(ag.name));
    const idle = g.find((ag) => /^idle$/i.test(ag.name)) ?? g.find((ag) => /idle/i.test(ag.name)) ?? g[0];
    /** 獵人＝揮砍動作；收銀員＝拿東西/工作循環（收錢時播放） */
    const attack =
      role === 'hunt'
        ? (g.find((ag) => /^sword$|slash|^stab$|attack/i.test(ag.name)) ?? g.find((ag) => /punch/i.test(ag.name)))
        : (g.find((ag) => /idle_holding|assembly_loop|pan_loop|chop_loop|holding/i.test(ag.name)) ?? idle);
    const sx = role === 'hunt' ? 0 : CONFIG.cash.x - 1.5;
    const sz = role === 'hunt' ? -CONFIG.arenaHalf + 1 : CONFIG.cash.z - 2;
    holder.position.set(sx, fleet.yOffset, sz);
    idle?.start(true);
    workers.push({
      role,
      root: holder,
      idle,
      walk,
      attack,
      animState: 'idle',
      baseScale: fleet.scale,
      yOffset: fleet.yOffset,
      x: sx,
      z: sz,
      target: null,
      attackAccum: 0,
      attackTimer: 0,
    });
  }

  /** 員工每幀行為：獵人巡場打怪、收銀員顧攤收錢 */
  function updateWorkers(dt: number) {
    if (!workers.length) return;
    const hc = CONFIG.hunter;
    const cc = CONFIG.cashier;
    for (const w of workers) {
      if (w.attackTimer > 0) w.attackTimer -= dt;
      let mv = false;
      if (w.role === 'hunt') {
        /** 目標失效就找最近的活怪 */
        if (!w.target || !w.target.alive || !w.target.active) {
          w.target = null;
          let bd = Infinity;
          for (const c of cows) {
            if (!c.active || !c.alive) continue;
            const q = (c.x - w.x) ** 2 + (c.z - w.z) ** 2;
            if (q < bd) {
              bd = q;
              w.target = c;
            }
          }
        }
        if (w.target) {
          const dx = w.target.x - w.x;
          const dz = w.target.z - w.z;
          const d = Math.hypot(dx, dz) || 1;
          w.root.rotation.y = Math.atan2(dx, dz);
          if (d > hc.range) {
            const step = Math.min(d, hc.speed * dt);
            w.x += (dx / d) * step;
            w.z += (dz / d) * step;
            mv = true;
          } else {
            w.attackAccum += dt;
            if (w.attackAccum >= hc.interval) {
              w.attackAccum = 0;
              w.attackTimer = 0.3;
              const c = w.target;
              c.hp -= hc.damage;
              c.pulse = 1;
              if (c.hp <= 0) {
                c.alive = false;
                c.dying = CONFIG.cow.deathSec;
                c.respawn = CONFIG.cow.respawnSec;
                c.bar.setEnabled(false);
                bloodDecals.spawn(c.x, c.z);
                burstAt(killFx, c.x, 1.0, c.z, 26);
                floatText.spawn(`+${c.meatYield}🥩`, c.x, 2.6, c.z, '#ffcf4a', 1.1);
                for (let k = 0; k < c.meatYield; k++) spawnDrop(c.x + (Math.random() - 0.5) * 1.2, c.z + (Math.random() - 0.5) * 1.2);
                sound.kill();
                w.target = null;
              } else {
                burstAt(hitFx, c.x, 1.2, c.z, 12);
                floatText.spawn(`${hc.damage}`, c.x, 2.6, c.z, '#ffffff', 0.7);
                sound.hit();
              }
            }
          }
        }
      } else {
        /** 收銀員：走到收銀台旁，站定就持續把桌上的錢收進金庫 */
        const tx = CONFIG.cash.x - 1.4;
        const tz = CONFIG.cash.z - 1.8;
        const dx = tx - w.x;
        const dz = tz - w.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.12) {
          const step = Math.min(d, cc.speed * dt);
          w.x += (dx / d) * step;
          w.z += (dz / d) * step;
          w.root.rotation.y = Math.atan2(dx, dz);
          mv = true;
        } else if (cashBars > 0) {
          w.attackTimer = 0.2; // 收錢中：播放工作動作（拿東西循環）
          w.attackAccum += dt;
          if (w.attackAccum >= 0.08) {
            w.attackAccum = 0;
            const give = Math.max(1, Math.round(cashPending / cashBars));
            const v = Math.min(give, cashPending);
            cashPending -= v;
            cashBars -= 1;
            money += v;
            collectShowSum += v;
            earn(v);
            /** 把金磚從收銀員丟到玩家背上 */
            const [bx, by, bz] = playerBack();
            goldFly.spawn(w.x, 1.2, w.z, bx, by, bz);
            sound.cash();
          }
        }
      }
      w.root.position.set(w.x, w.yOffset, w.z);
      setWorkerAnim(w, w.attackTimer > 0 ? 'attack' : mv ? 'walk' : 'idle');
    }
  }

  /** ===== 房子防禦戰 ===== */
  function setZombieAnim(z: Zombie, state: Zombie['animState']) {
    if (z.animState === state) return;
    z.animState = state;
    z.idle?.stop();
    z.walk?.stop();
    z.attack?.stop();
    z.death?.stop();
    if (state === 'walk') z.walk?.start(true);
    else if (state === 'attack') (z.attack ?? z.idle)?.start(true); // 無攻擊動畫（如 Boss）→ 用 idle
    else if (state === 'death') z.death?.start(false);
    else z.idle?.start(true);
  }

  /** 依波次挑兵種：越後面越可能出骷髏/胖子 */
  function pickZombieType(): string {
    const r = Math.random();
    if (waveNum >= 3 && r < 0.22) return 'chubby';
    if (waveNum >= 2 && r < 0.5) return 'skeleton';
    return 'basic';
  }

  /** 從東門啟用一隻池中殭屍（forceType 用於指定 Boss）；回傳是否成功 */
  function spawnZombie(forceType?: string): boolean {
    const type = forceType ?? pickZombieType();
    const z = zombies.find((q) => !q.active && q.type === type) ?? (forceType ? undefined : zombies.find((q) => !q.active));
    if (!z) return false;
    const y = CONFIG.house.yard;
    /** 從地圖遠方東側（角落）生成，z 分散到遠角，再走向東門 */
    z.x = y.maxX + 16 + Math.random() * 6;
    z.z = -38 + Math.random() * 54;
    z.entered = false;
    z.slowT = 0;
    z.slowFactor = 1;
    setZombieGlow(z, false);
    /** Boss 血量隨波加成更高 */
    z.hpMax = z.baseHp + (waveNum - 1) * DEF.wave.hpPerWave * (z.isBoss ? 5 : 1);
    z.hp = z.hpMax;
    z.alive = true;
    z.active = true;
    z.dying = 0;
    z.attackAccum = 0;
    z.root.setEnabled(true);
    z.root.position.set(z.x, z.yOffset, z.z);
    z.death?.stop();
    z.idle?.stop();
    z.walk?.start(true);
    z.animState = 'walk';
    if (z.isBoss) floatText.spawn('👹 BOSS!', z.x, 6, z.z, '#ff5b5b', 1.8);
    return true;
  }

  /** 對殭屍造成傷害（玩家或塔共用）：含火花/血花/掉錢/傷害數字 */
  function damageZombie(z: Zombie, dmg: number) {
    if (!z.active || !z.alive) return;
    z.hp -= dmg;
    if (dmgNumThisFrame < DMG_NUM_CAP) burstAt(hitFx, z.x, 1.4, z.z, 10); // 火花也跟著節流
    dmgNumber(`${Math.round(dmg)}`, z.x, z.z);
    if (z.hp <= 0) {
      z.alive = false;
      z.dying = DEF.zombie.deathSec;
      bloodDecals.spawn(z.x, z.z);
      burstAt(killFx, z.x, 1.0, z.z, 24);
      money += z.reward;
      earn(z.reward);
      pendZombies++;
      floatText.spawn(`+$${z.reward}`, z.x, 2.9, z.z, '#ffcf4a', 1.0);
      setZombieAnim(z, 'death');
      sound.kill();
      if (z.isBoss) achieve('boss');
    } else {
      sound.hit();
    }
  }

  /** 塔射擊細線（池循環） */
  function fireTowerTracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const t = towerTracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % towerTracers.length;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 0.1;
    t.mesh.position.set(ax + dx * 0.5, ay + dy * 0.5, az + dz * 0.5);
    t.mesh.scaling.set(1, 1, len);
    t.mesh.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0);
    t.mesh.setEnabled(true);
    t.life = 0.07;
  }

  /** 砲塔發射炸彈：拋向目標，抵達才爆炸（攜帶該次傷害） */
  /** 在落點施加範圍減速（緩速炸彈用） */
  function applySlowSplash(tx: number, tz: number, splash: number, factor: number) {
    const sp2 = splash * splash;
    for (const z of zombies) {
      if (!z.active || !z.alive) continue;
      if ((z.x - tx) ** 2 + (z.z - tz) ** 2 <= sp2) {
        z.slowT = DEF.slow.slowSec;
        z.slowFactor = z.slowFactor < 1 ? Math.min(z.slowFactor, factor) : factor;
      }
    }
  }

  function fireBomb(fx: number, fy: number, fz: number, tx: number, tz: number, dmg: number, slow = false, slowFactor = 1) {
    const b = bombs.find((q) => !q.active && q.slow === slow);
    if (!b) {
      /** 無可用炸彈（模型未載入/池滿）→ 直接在目標生效，確保不漏 */
      if (slow) {
        burstAt(frostFx, tx, 1.0, tz, 30);
        spawnFrostPatch(tx, tz);
        sound.frost();
        applySlowSplash(tx, tz, DEF.slow.splash, slowFactor);
      } else {
        spawnExplosion(tx, 1.2, tz);
        const sp2 = DEF.cannon.splash * DEF.cannon.splash;
        for (const z of zombies) if (z.active && z.alive && (z.x - tx) ** 2 + (z.z - tz) ** 2 <= sp2) damageZombie(z, dmg);
      }
      return;
    }
    b.active = true;
    b.fx = fx;
    b.fy = fy;
    b.fz = fz;
    b.tx = tx;
    b.tz = tz;
    b.t = 0;
    b.dmg = dmg;
    b.slowFactor = slowFactor;
    b.inst.setEnabled(true);
    b.inst.position.set(fx, fy, fz);
  }

  /** 更新所有飛行中的炸彈；抵達目標 → 爆炸（傷害）或藍色減速 */
  function updateBombs(dt: number) {
    const dur = 0.5;
    updateFrostPatches(dt);
    for (const b of bombs) {
      if (!b.active) continue;
      b.t += dt / dur;
      if (b.t >= 1) {
        b.active = false;
        b.inst.setEnabled(false);
        if (b.slow) {
          burstAt(frostFx, b.tx, 1.0, b.tz, 30); // 藍色冰霜爆裂
          spawnFrostPatch(b.tx, b.tz); // 地面冰霜圈（標示減速範圍）
          sound.frost();
          applySlowSplash(b.tx, b.tz, b.splash, b.slowFactor);
        } else {
          spawnExplosion(b.tx, 1.2, b.tz);
          const sp2 = b.splash * b.splash;
          for (const z of zombies) if (z.active && z.alive && (z.x - b.tx) ** 2 + (z.z - b.tz) ** 2 <= sp2) damageZombie(z, b.dmg);
        }
        continue;
      }
      const k = b.t;
      const x = b.fx + (b.tx - b.fx) * k;
      const z = b.fz + (b.tz - b.fz) * k;
      const y = b.fy + (1.2 - b.fy) * k + Math.sin(k * Math.PI) * 3.5; // 拋物線
      b.inst.position.set(x, y, z);
      b.inst.rotation.y += dt * 8;
      b.inst.rotation.x += dt * 6;
    }
  }

  /** 切換殭屍身體藍光（被緩速時） */
  function setZombieGlow(z: Zombie, on: boolean) {
    if (on === z.glowing) return;
    z.glowing = on;
    for (const m of z.meshes) {
      if (on) slowGlow.addMesh(m, SLOW_GLOW_COLOR);
      else slowGlow.removeMesh(m);
    }
  }

  function updateDefense(dt: number) {
    if (waveState === 'idle') return;
    updateBombs(dt);
    /** 警戒線脈動：越接近失守(攻入多)脈動越快越亮 */
    breachPulseT += dt;
    const urgency = breaches / BREACH_MAX;
    breachLineMat.alpha = 0.22 + (0.16 + urgency * 0.3) * (0.5 + 0.5 * Math.sin(breachPulseT * (4 + urgency * 8)));

    /** 塔射擊細線衰減 */
    for (const t of towerTracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.mesh.setEnabled(false);
      }
    }

    /** 蓋塔（站塔位付款）+ 塔自動射擊（升級改點塔開選單） */
    for (let i = 0; i < towerPads.length; i++) {
      const pad = towerPads[i];
      const cfg = towerCfgOf(pad.type);
      if (!pad.built && near(pad.x, pad.z, 2.0) && money > 0) {
        /** 蓋塔 */
        const pay = Math.min(cfg.cost - pad.paid, money, (cfg.cost / WEAPON_BUY_TIME) * dt);
        pad.paid += pay;
        money -= pay;
        payFlyAccum += pay;
        while (payFlyAccum >= PAY_PER_BAR) {
          payFlyAccum -= PAY_PER_BAR;
          spawnPayFly(pad.x, pad.z);
        }
        if (pad.paid >= cfg.cost - 0.001) {
          pad.built = true;
          pad.level = 1;
          const src = pad.type === 'cannon' ? cannonSrc : pad.type === 'slow' ? slowSrc : towerSrc;
          if (src) {
            const inst = src.createInstance('tower');
            inst.position.set(pad.x, 0, pad.z);
            inst.isPickable = false;
            inst.parent = houseHolder;
            pad.inst = inst;
          }
          setTowerPips(i);
          refreshTowerSign(i);
          sound.upgrade();
        }
      }
      if (!pad.built) continue;
      /** 已蓋：等級加成傷害/射速/射程 */
      const dmg = cfg.dmg * (1 + (pad.level - 1) * 0.5);
      const interval = cfg.interval / (1 + (pad.level - 1) * 0.35);
      const range = towerRange(pad);
      /** 每幀鎖定最近殭屍（供瞄準與開火） */
      let best: Zombie | null = null;
      let bd = range * range;
      for (const z of zombies) {
        if (!z.active || !z.alive) continue;
        const q = (z.x - pad.x) ** 2 + (z.z - pad.z) ** 2;
        if (q < bd) {
          bd = q;
          best = z;
        }
      }
      /** 砲管轉向目標（平滑；緩速塔=消防栓不轉） */
      if (best && pad.inst && pad.type !== 'slow') {
        const aim = Math.atan2(best.x - pad.x, best.z - pad.z) + TURRET_AIM_OFFSET;
        let cur = pad.inst.rotation.y;
        let diff = aim - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        pad.inst.rotation.y = cur + diff * Math.min(1, dt * 10);
      }
      pad.fireAccum += dt;
      if (pad.fireAccum >= interval && best) {
        pad.fireAccum = 0;
        /** 高等級一次多發：Lv3 起 2 發、Lv4 起 3 發，分別射向最近的數隻 */
        const shots = Math.max(1, pad.level - 1);
        const targets =
          shots === 1
            ? [best]
            : zombies
                .filter((z) => z.active && z.alive && (z.x - pad.x) ** 2 + (z.z - pad.z) ** 2 <= range * range)
                .sort((a, b) => (a.x - pad.x) ** 2 + (a.z - pad.z) ** 2 - ((b.x - pad.x) ** 2 + (b.z - pad.z) ** 2))
                .slice(0, shots);
        for (const tgt of targets) {
          if (pad.type === 'slow') {
            /** 緩速塔：丟藍色炸彈，落點範圍減速（等級越高越強） */
            const eff = Math.max(0.15, DEF.slow.slowFactor - (pad.level - 1) * 0.05);
            fireBomb(pad.x, 3.0, pad.z, tgt.x, tgt.z, 0, true, eff);
          } else if (pad.type === 'cannon') {
            /** 砲塔：丟出炸彈，飛到目標才爆炸（範圍傷害） */
            fireBomb(pad.x, 3.6, pad.z, tgt.x, tgt.z, dmg);
          } else {
            fireTowerTracer(pad.x, 3.6, pad.z, tgt.x, 1.6, tgt.z);
            burstAt(muzzleFx, pad.x, 3.6, pad.z, 4);
            damageZombie(tgt, dmg);
          }
        }
      }
    }

    /** 殭屍 AI：走向房子 → 啃房子血 */
    for (const z of zombies) {
      if (!z.active) continue;
      if (!z.alive) {
        z.bar?.setEnabled(false); // 死亡動畫時不顯示血條
        setZombieGlow(z, false);
        z.dying -= dt;
        z.root.position.set(z.x, z.yOffset, z.z);
        if (z.dying <= 0) {
          z.active = false;
          z.root.setEnabled(false);
        }
        continue;
      }
      /** 緩速塔減速：slowT>0 時移動速度乘上 slowFactor，並顯示藍色霜凍光球 */
      if (z.slowT > 0) {
        z.slowT -= dt;
        if (z.slowT <= 0) z.slowFactor = 1;
      }
      const slowed = z.slowT > 0;
      const sp = slowed ? z.speed * z.slowFactor : z.speed;
      setZombieGlow(z, slowed);
      /** 已攻入基地（越過圍欄）→ 計入侵、移除該怪；達上限即失守 */
      if (z.x <= BASE_BREACH_X) {
        breaches++;
        camShake = Math.max(camShake, 0.6);
        sound.boom();
        floatText.spawn(`🧟 攻入! ${breaches}/${BREACH_MAX}`, z.x, 4, z.z, '#ff6b6b', 1.4);
        z.active = false;
        z.alive = false;
        z.root.setEnabled(false);
        z.bar?.setEnabled(false);
        setZombieGlow(z, false);
        if (breaches >= BREACH_MAX && waveState !== 'lost') {
          waveState = 'lost';
          zombiesToSpawn = 0;
          bossToSpawn = 0;
          for (const q of zombies)
            if (q.active) {
              q.active = false;
              q.root.setEnabled(false);
              q.bar?.setEnabled(false);
              setZombieGlow(q, false);
            }
        }
        continue;
      }
      /** 走向基地中心 */
      const dx = BASE_CX - z.x;
      const dz = BASE_CZ - z.z;
      const d = Math.hypot(dx, dz) || 1;
      z.root.rotation.y = Math.atan2(dx, dz);
      const step = Math.min(d, sp * dt);
      z.x += (dx / d) * step;
      z.z += (dz / d) * step;
      setZombieAnim(z, 'walk');
      z.root.position.set(z.x, z.yOffset, z.z);
      /** 頭頂血條：只在受傷時顯示（滿血不畫，省 overdraw / draw call）；Boss 一律顯示 */
      if (z.bar) {
        const showBar = z.isBoss || z.hp < z.hpMax - 0.01;
        z.bar.setEnabled(showBar);
        if (showBar) {
          z.bar.setRatio(Math.max(0, z.hp) / z.hpMax);
          z.bar.setPosition(z.x, z.isBoss ? 6.2 : 3.0, z.z);
        }
      }
    }

    if (waveState === 'prep') {
      waveTimer -= dt;
      if (waveTimer <= 0) {
        waveNum++;
        if (waveNum > bestWaveReached) bestWaveReached = waveNum;
        zombiesToSpawn = DEF.wave.baseCount + (waveNum - 1) * DEF.wave.perWaveAdd;
        bossToSpawn = waveNum % DEF.bossEvery === 0 ? 1 : 0; // 每 bossEvery 波出 Boss
        zombieSpawnAccum = DEF.wave.spawnGap;
        waveState = 'active';
      }
    } else if (waveState === 'active') {
      if (zombiesToSpawn > 0 || bossToSpawn > 0) {
        zombieSpawnAccum += dt;
        /** 後期加速：間隔隨波縮短、且一次生成多隻，避免屍潮拖太久 */
        const gap = Math.max(0.18, DEF.wave.spawnGap - (waveNum - 1) * 0.02);
        const perTick = 1 + Math.floor((waveNum - 1) / 3);
        if (zombieSpawnAccum >= gap) {
          zombieSpawnAccum = 0;
          for (let s = 0; s < perTick; s++) {
            if (!zombies.some((q) => !q.active)) break;
            if (zombiesToSpawn > 0) {
              if (spawnZombie()) zombiesToSpawn--;
              else break;
            } else if (bossToSpawn > 0) {
              if (spawnZombie('boss')) bossToSpawn--;
              else break;
            } else break;
          }
        }
      } else if (!zombies.some((q) => q.active)) {
        /** 本波清空：給獎勵 */
        const reward = DEF.wave.clearReward + (waveNum - 1) * DEF.wave.rewardPerWave;
        money += reward;
        floatText.spawn(`第 ${waveNum} 波清空 +$${reward}`, BASE_CX, 7, BASE_CZ, '#7cf08a', 1.6);
        if (waveNum >= 10) achieve('wave10');
        if (waveNum >= 20) achieve('wave20');
        if (waveNum >= DEF.winWave) {
          /** 通關！ */
          achieve('win');
          waveState = 'won';
          floatText.spawn('🏆 通關！撐過 30 波！', BASE_CX, 9, BASE_CZ, '#ffe066', 2.4);
          sound.upgrade();
        } else {
          waveState = 'prep';
          waveTimer = DEF.prepSec;
        }
      }
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

  /**
   * 把玩家限制在「店面 ∪ 牧場 ∪ 走廊 ∪ 院子」的合法矩形聯集內：
   * 落在任一矩形內就放行；否則夾到「最近的合法矩形」邊界（等同四周都有牆，不會穿牆/被傳送）。
   * 最後再把玩家推出房子實心碰撞箱。
   */
  function clampPlayer(p: Vector3) {
    const a = CONFIG.arenaHalf;
    const P2 = CONFIG.pasture2;
    const y = CONFIG.house.yard;
    /** 合法矩形 [x0,x1,z0,z1] */
    const R: [number, number, number, number][] = [
      [-a + 1, a - 1, -a + 1, a - 1], // 店面
      [-2.6, 2.6, P.cz + P.halfZ - 1.2, -a + 2], // 往牧場1 北走道
      [P.cx - P.halfX + 0.8, P.cx + P.halfX - 0.8, P.cz - P.halfZ + 0.8, P.cz + P.halfZ - 0.8], // 牧場1
    ];
    if (pasture2Unlocked) {
      R.push([P2.cx + P2.halfX - 1.2, -a + 2, -10, -4]); // 往牧場2 西走道
      R.push([P2.cx - P2.halfX + 0.8, P2.cx + P2.halfX - 0.8, P2.cz - P2.halfZ + 0.8, P2.cz + P2.halfZ - 0.8]); // 牧場2
    }
    if (houseBought) {
      R.push([a - 2, y.minX + 1.2, -10, -4]); // 往房子 東走道
      R.push([y.minX + 0.8, y.maxX - 0.8, y.minZ + 0.8, y.maxZ - 0.8]); // 院子
    }
    const eps = 0.001;
    let inside = false;
    for (const r of R) {
      if (p.x >= r[0] - eps && p.x <= r[1] + eps && p.z >= r[2] - eps && p.z <= r[3] + eps) {
        inside = true;
        break;
      }
    }
    if (!inside) {
      let bx = p.x;
      let bz = p.z;
      let bd = Infinity;
      for (const r of R) {
        const cx = Math.max(r[0], Math.min(r[1], p.x));
        const cz = Math.max(r[2], Math.min(r[3], p.z));
        const d = (cx - p.x) ** 2 + (cz - p.z) ** 2;
        if (d < bd) {
          bd = d;
          bx = cx;
          bz = cz;
        }
      }
      p.x = bx;
      p.z = bz;
    }
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
      canvas.removeEventListener('pointerdown', onTowerPick);
      backStack.mesh.dispose();
      goldStack.mesh.dispose();
      treeField?.dispose();
      dynamiteStation.dispose();
      pasture2Holder.dispose();
      bloodDecals.dispose();
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
      workers.forEach((w) => w.root.dispose());
      hunterStation.dispose();
      cashierStation.dispose();
      houseStation.dispose();
      houseHolder.dispose();
      slowGlow.dispose();
      zombies.forEach((z) => {
        z.bar?.dispose();
        z.root.dispose();
      });
      zombieFleets.forEach((f) => f.container.dispose());
      towerTracers.forEach((t) => t.mesh.dispose());
      towerSrc?.dispose();
      cannonSrc?.dispose();
      slowSrc?.dispose();
      bombs.forEach((b) => b.inst.dispose());
      bombSrc?.dispose();
      slowBombSrc?.dispose();
      frostPatches.forEach((p) => p.mesh.dispose());
      frostPatchMat.dispose();
      rangeRing.dispose();
      towerPads.forEach((p) => p.pips.forEach((m) => m.dispose()));
      pipMat.dispose();
      hitFx.dispose();
      killFx.dispose();
      muzzleFx.dispose();
      sparkTex.dispose();
      floatText.dispose();
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
    setHardwareScaling(level: number) {
      engine.setHardwareScalingLevel(Math.max(0.5, Math.min(3, level)));
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
    upgradeSelectedTower() {
      doUpgradeTower();
    },
    deselectTower() {
      selectedPad = -1;
      rangeRing.setEnabled(false);
    },
    startDefense() {
      if (!defenseIntroPending) return;
      if (money < CONFIG.house.cost) return; // 需身上有 $5000 才能開啟（不扣錢）
      defenseIntroPending = false;
      breaches = 0;
      waveState = 'prep';
      waveTimer = 60; // 1 分鐘後第一波
    },
    setWave(n: number) {
      /** 還沒蓋房子 → 先蓋好（炸地、長房子、紅磚院子、塔位） */
      if (!houseBought) {
        houseBought = true;
        houseStation.setDone();
        revealHouse();
      }
      /** 清掉場上殭屍，直接從第 n 波開始 */
      for (const z of zombies)
        if (z.active) {
          z.active = false;
          z.root.setEnabled(false);
          z.bar?.setEnabled(false);
        }
      zombiesToSpawn = 0;
      bossToSpawn = 0;
      waveNum = Math.max(1, Math.round(n)) - 1;
      breaches = 0;
      defenseIntroPending = false;
      waveState = 'prep';
      waveTimer = 0.2; // 幾乎立刻開打該波
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
    inst.freezeWorldMatrix(); // 靜態柵欄
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
    if (!(p >= -10 && p <= -4)) fenceSeg(scene, center, wood, -half, p, false, seg); // 西牆缺口（往牧場2 走道 z∈[-10,-4]）
    if (!(p >= -10 && p <= -4)) fenceSeg(scene, center, wood, half, p, false, seg); // 東牆缺口（往房子院子 z∈[-10,-4]）
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

/** 塔位浮空牌內容（emoji + 一行說明），可重畫以更新等級/費用 */
function drawTowerSign(tex: DynamicTexture, emoji: string, sub: string, subColor = '#ffd24a') {
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const W = 256;
  const H = 140;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(20,30,55,0.84)';
  roundRect(ctx, 6, 6, W - 12, H - 12, 24);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '64px sans-serif';
  ctx.fillText(emoji, W / 2, 50);
  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = subColor;
  ctx.fillText(sub, W / 2, 108);
  tex.hasAlpha = true;
  tex.update();
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
    /** 武器圖案 + 名稱 */
    ctx.font = '84px sans-serif';
    ctx.fillText(this.def.emoji, W / 2, 64);
    ctx.font = 'bold 40px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.def.name, W / 2, 126);

    if (this.bought) {
      ctx.font = 'bold 42px sans-serif';
      ctx.fillStyle = this.equippedNow ? '#9af0b0' : '#cfe6ff';
      ctx.fillText(this.equippedNow ? '✓ 裝備中' : '踩上裝備', W / 2, 188);
    } else {
      /** 價格 */
      ctx.font = 'bold 48px sans-serif';
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(`💰${this.def.cost}`, W / 2, 178);
      /** 進度條（左→右填綠） */
      const ix = 34;
      const iy = 210;
      const iw = W - 68;
      const ih = 32;
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
    private title: string,
    private effect: string,
    private doneText: string,
    private requireMode = false,
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
    ctx.font = '74px sans-serif';
    ctx.fillText(this.emoji, W / 2, 56);
    /** 名稱 + 一句效果（讓人看懂功用） */
    ctx.font = 'bold 38px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.title, W / 2, 112);
    ctx.font = '26px sans-serif';
    ctx.fillStyle = '#bcd6ff';
    ctx.fillText(this.effect, W / 2, 146);
    if (this.done) {
      ctx.font = 'bold 34px sans-serif';
      ctx.fillStyle = '#9af0b0';
      ctx.fillText(this.doneText, W / 2, 196);
    } else {
      ctx.font = 'bold 42px sans-serif';
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(this.requireMode ? `需💰${this.cost}` : `💰${this.cost}`, W / 2, 184);
      const ix = 34;
      const iy = 212;
      const iw = W - 68;
      const ih = 30;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, ix, iy, iw, ih, 12);
      ctx.fill();
      if (this.progress > 0.01) {
        ctx.fillStyle = 'rgba(90,220,120,0.95)';
        roundRect(ctx, ix, iy, Math.max(12, iw * this.progress), ih, 12);
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

