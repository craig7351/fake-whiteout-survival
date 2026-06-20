/** 雪地肉舖經營：可調參數 */
export const CONFIG = {
  /** 店面圍場半徑（柵欄圍出的營業範圍） */
  arenaHalf: 12,

  player: {
    /** 基礎移動速度（可被升級提升） */
    speed: 9,
    radius: 0.7,
    /** 走到攤位/收銀/升級的「互動」判定半徑 */
    reach: 2.2,
    /** 角色模型高度（背肉堆參數依此調校） */
    height: 2.2,
    /** 生命值與每秒回復（停止受擊 1.2s 後回復） */
    maxHp: 100,
    regen: 16,
    regenDelay: 1.2,
  },

  /** 近戰：玩家自動揮刀打牛 */
  combat: {
    /** 攻擊判定半徑 */
    range: 2.6,
    /** 攻擊間隔（秒） */
    interval: 0.45,
    /** 基礎傷害（屠宰刀升級提升） */
    damage: 2,
    /** 觸發一次攻擊後維持攻擊動畫的秒數（參考原專案） */
    animSec: 0.4,
  },

  /** 牧場：店面後方圍出的牛圈（放大版），牛持續重生供玩家獵殺取肉 */
  pasture: {
    /** 中心與半邊長（位於店面北側，z 為負；南緣須在放大後店面後牆 -arenaHalf 之北） */
    cx: 0,
    cz: -21,
    halfX: 11,
    halfZ: 8,
  },

  /** 牧場2：位於店面西側，初始為樹林覆蓋，買炸藥（💲500）後炸開、放出牛群 */
  pasture2: {
    cx: -24,
    cz: -2,
    halfX: 11,
    halfZ: 8,
  },

  /** 炸藥購買框：站在框內持續付款，付滿即炸開牧場2 */
  dynamite: {
    x: -7,
    z: -10,
    cost: 500,
  },

  /** 牧羊犬購買框：付滿 💲300 召喚一隻狗，會自動把地上的肉撿回攤位 */
  dog: {
    x: 10,
    z: 0,
    cost: 300,
    /** 模型正規化最長邊（放大 1.7 倍：1.8 × 1.7） */
    size: 3.06,
    /** 移動速度 */
    speed: 6,
    /** 撿到肉的判定半徑 */
    pickRadius: 1.1,
    /** 一趟最多背幾片肉（背上會越疊越高，集滿才送回攤位） */
    carryMax: 100,
    /** 背上每片肉的疊高間距 */
    carryStep: 0.16,
  },

  /** 自動化員工：獵人（自動打怪）與收銀員（自動收錢） */
  hunter: {
    x: 6,
    z: -10,
    cost: 700,
    size: 3.4, // 模型高度（放大 1.7 倍：2.0 × 1.7）
    speed: 6,
    damage: 3,
    interval: 0.6, // 攻擊間隔
    range: 2.6, // 攻擊距離
  },
  cashier: {
    x: 10,
    z: 4,
    cost: 400,
    size: 2.0,
    speed: 6,
    /** 站到收銀台旁多近開始收錢 */
    reach: 2.2,
  },

  /** 塔防開關框：不扣錢，身上累積到 cost（$10000）即可開啟塔防戰 */
  house: {
    x: 10,
    z: 8,
    cost: 10000,
    /** 房子(inn)位置：院子中央再往牧場(西北)方向移約 10% */
    hx: 25.65,
    hz: -9.75,
    /** 模型正規化最長邊（縮小為原本 60%：12 × 0.6） */
    size: 7.2,
    /** 紅磚圍牆院子範圍：西牆貼店面東側留入口，北推到牧場1 邊緣、東外擴 */
    yard: { minX: 13, maxX: 44, minZ: -28, maxZ: 11 },
    /** 殭屍入口：東牆缺口（z 範圍中心/半寬） */
    zombieGap: { center: -8.5, half: 4 },
    /** 塔位：東側(靠殭屍入口)箭/砲塔各一；房屋左右兩側(沿 z 軸)各一座緩速塔 */
    towerPads: [
      { x: 40.5, z: -24.5, type: 'cannon' as const },
      { x: 40.5, z: 7.5, type: 'arrow' as const },
      { x: 25.65, z: -17.75, type: 'slow' as const },
      { x: 25.65, z: -1.75, type: 'slow' as const },
    ],
  },

  /** 牛 */
  cow: {
    /** 同時存活數（被殺後會補回此數） */
    count: 30,
    hp: 6,
    /** 遊蕩速度 */
    wanderSpeed: 1.8,
    /** 追玩家速度（看到玩家偶爾會衝過來頂一下） */
    chaseSpeed: 3.0,
    /** 進入此半徑「才」可能追玩家（縮小，不再遠遠就追） */
    aggroRadius: 5,
    /** 單次最多追幾秒就放棄 */
    maxChaseSec: 2.2,
    /** 放棄後冷靜幾秒內不再追（這段時間只遊蕩） */
    calmSec: 5,
    /** 貼到此半徑就對玩家造成接觸傷害並擊退 */
    contactRadius: 1.8,
    /** 接觸傷害（每秒，攻擊力不高） */
    contactDps: 6,
    /** 撞到玩家的擊退力道 */
    knockback: 2.5,
    /** 死亡動畫時長（秒，播完倒地動畫才消失重生） */
    deathSec: 1.4,
    /** 被殺後重生延遲（秒，從死亡動畫結束起算） */
    respawnSec: 2.5,
    /** 每頭牛掉幾塊肉 */
    meatYield: 3,
    /** 模型正規化最長邊（較原本放大 2 倍） */
    size: 3.4,
    /** 模型面向修正（若走路時牛屁股朝前，改成 Math.PI） */
    faceOffset: 0,
  },

  /** 地上掉落的肉（玩家走過去自動撿） */
  meatDrop: {
    /** 撿取半徑：需 ≥ 攻擊距離，否則「在攻擊距離外打死的牛」掉的肉會撿不到 */
    pickupRadius: 3.4,
    max: 90,
  },

  /** 玩家攜帶 */
  carry: {
    /** 基礎可背肉塊數（升級提升） */
    base: 6,
    /** 背上肉塊堆疊的層高 */
    stackGap: 0.34,
  },

  /** 販售攤位：擺肉給顧客買 */
  counter: {
    x: 0,
    z: 5,
    /** 攤位最多陳列幾塊肉（升級提升） */
    base: 8,
    /** 一塊肉售價（基礎，升級提升單價） */
    price: 5,
  },

  /** 顧客（從店面前方大門進場） */
  customer: {
    /** 同時在場上限（效能考量的硬上限，視為「無上限的人潮」） */
    max: 24,
    spawnSec: 1.4,
    speed: 4.2,
    gate: { x: 0, z: 15 },
    /** 角色模型高度 */
    height: 1.7,
    /** 模型面向修正（若走路時背對前進方向，改成 Math.PI） */
    faceOffset: 0,
  },

  /** 收銀：顧客付的錢堆在攤位旁的收銀格，玩家走過去收進錢包 */
  cash: {
    x: 3.5,
    z: 5,
  },

  camera: {
    /** 等距俯視角度與距離（手機：拉近、橫向固定 FOV 框景） */
    alpha: -Math.PI / 2,
    beta: Math.PI / 3.4,
    radius: 19,
    lowerRadius: 8,
    upperRadius: 75,
    /** 平滑跟隨玩家的速度 */
    follow: 4,
  },

  /** 房子防禦戰：蓋好房子後一波波殭屍從東門攻打房子，蓋塔防守 */
  defense: {
    houseHp: 200,
    houseRegen: 12, // 準備期每秒回血
    prepSec: 14, // 每波之間的準備時間
    firstDelay: 8, // 蓋好房子後第一波延遲
    repairCost: 400, // 房子毀損後修復費用
    /** 殭屍共用參數 */
    zombie: { attackInterval: 0.9, attackRange: 2.6, deathSec: 1.2 },
    /** 殭屍兵種：基本 / 骷髏(快脆) / 胖子(肉盾高傷) */
    zombieTypes: {
      basic: { model: '/models/enemies/Zombie_Basic.glb', size: 2.3, hp: 8, speed: 3.0, dmg: 7, reward: 12, pool: 100 },
      skeleton: { model: '/models/enemies/Characters_Skeleton.glb', size: 2.3, hp: 5, speed: 4.8, dmg: 5, reward: 14, pool: 80 },
      chubby: { model: '/models/enemies/Zombie_Chubby.glb', size: 2.9, hp: 24, speed: 1.9, dmg: 14, reward: 30, pool: 60 },
      boss: { model: '/models/enemies/Zombie_Ribcage.glb', size: 5.2, hp: 140, speed: 1.7, dmg: 32, reward: 250, pool: 10 },
    },
    /** 每幾波出現一隻 Boss */
    bossEvery: 3,
    /** 撐過第幾波即通關 */
    winWave: 30,
    /** 波次：數量與血量隨波遞增 */
    wave: { baseCount: 6, perWaveAdd: 3, hpPerWave: 1.5, spawnGap: 0.8, clearReward: 100, rewardPerWave: 30 },
    /** 箭塔（單體、快） */
    tower: { cost: 250, range: 20, dmg: 4, interval: 0.45, size: 3.2 },
    /** 砲塔（慢、範圍爆擊濺射） */
    cannon: { cost: 450, range: 22, dmg: 6, interval: 1.2, splash: 3.5, size: 4.0 },
    /** 緩速塔（消防栓，發射藍色炸彈；落點範圍內殭屍減速，無傷害） */
    slow: { cost: 350, range: 32, dmg: 0, interval: 1.0, size: 5.0, slowFactor: 0.45, slowSec: 1.6, splash: 5 },
    /** 塔最大升級等級（每級提升傷害與射速） */
    towerMaxLevel: 4,
  },
};

/** 升級項目定義（站到對應地墊上、錢夠就持續扣款升級） */
export interface UpgradeDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  /** 場景中地墊位置 */
  x: number;
  z: number;
  maxLevel: number;
  /** 第 n 級（從 0 起算）的花費 */
  cost: (lvl: number) => number;
}

/** 升級項目（站到地墊上、錢夠就持續扣款升級，成本指數成長） */
export const UPGRADES: UpgradeDef[] = [
  {
    id: 'flow',
    name: '招攬客流',
    emoji: '🚪',
    desc: '顧客來得更快、更多',
    x: -9,
    z: 9,
    maxLevel: 20,
    cost: (lvl) => Math.floor(40 * Math.pow(1.45, lvl)),
  },
];

/** 武器定義：三種各有不同攻擊力／範圍／速度，踩牧場入口的武器框框即可裝備 */
export interface WeaponDef {
  id: string;
  name: string;
  emoji: string;
  model: string;
  /** 模型正規化最長邊 */
  size: number;
  /** 每次攻擊基礎傷害（再乘上「攻擊力」升級） */
  damage: number;
  /** 攻擊間隔（秒，越小越快） */
  interval: number;
  /** 攻擊判定距離 */
  range: number;
  /** 一次可命中幾隻牛（近戰範圍斬） */
  cleave: number;
  /** 是否遠程（衝鋒槍：遠距離掃射） */
  ranged: boolean;
  /** 是否迴旋斧：斧頭繞玩家旋轉、攻擊範圍內所有怪物 */
  whirl?: boolean;
  /** 購買價格（0 = 起始免費） */
  cost: number;
  /** 武器框框（地墊）位置 */
  x: number;
  z: number;
  /** 握在手上的位移／旋轉（相對玩家；視覺微調用） */
  hand: { x: number; y: number; z: number; rx: number; ry: number; rz: number };
}

/** 順序＝牧場入口三個框框由左到右 */
export const WEAPONS: WeaponDef[] = [
  {
    id: 'axe',
    name: '迴旋斧',
    emoji: '🪓',
    model: '/models/weapons/axe.glb',
    size: 1.0,
    damage: 4,
    interval: 0.3,
    range: 4.0,
    cleave: 99, // 範圍內所有怪物
    ranged: false,
    whirl: true,
    cost: 200,
    x: -10,
    z: -2,
    hand: { x: 0.32, y: 1.0, z: 0.28, rx: -0.5, ry: 0, rz: 0.2 },
  },
  {
    id: 'sword',
    name: '大砍刀',
    emoji: '🗡️',
    model: '/models/weapons/sword.glb',
    size: 1.05,
    damage: 3.5,
    interval: 0.4,
    range: 3.8,
    cleave: 3,
    ranged: false,
    cost: 0,
    x: -10,
    z: 2,
    hand: { x: 0.32, y: 1.0, z: 0.3, rx: 1.51, ry: 1.76, rz: 1.35 },
  },
  {
    id: 'smg',
    name: '衝鋒槍',
    emoji: '🔫',
    model: '/models/weapons/smg.glb',
    size: 0.62,
    damage: 1.6,
    interval: 0.1,
    range: 13,
    cleave: 1,
    ranged: true,
    cost: 800,
    x: -10,
    z: 6,
    hand: { x: 0.3, y: 1.0, z: 0.4, rx: 0, ry: 0, rz: 0 },
  },
];

/** 起始武器 id */
export const START_WEAPON = 'sword';
