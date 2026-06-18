/** 雪地肉舖經營：可調參數 */
export const CONFIG = {
  /** 店面圍場半徑（柵欄圍出的營業範圍；手機緊湊佈局） */
  arenaHalf: 9,

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
    /** 中心與半邊長（位於店面北側，z 為負；手機緊湊版、拉近店面） */
    cx: 0,
    cz: -18,
    halfX: 11,
    halfZ: 8,
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
    gate: { x: 0, z: 11 },
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
    lowerRadius: 13,
    upperRadius: 30,
    /** 平滑跟隨玩家的速度 */
    follow: 4,
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

/** 升級項目（已全部移除：肉品單價／移動速度／攻擊力／招攬客流） */
export const UPGRADES: UpgradeDef[] = [];

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
    name: '斧頭',
    emoji: '🪓',
    model: '/models/weapons/axe.glb',
    size: 1.0,
    damage: 8,
    interval: 0.75,
    range: 2.8,
    cleave: 1,
    ranged: false,
    cost: 200,
    x: -7,
    z: -4,
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
    x: -7,
    z: 0,
    hand: { x: 0.32, y: 1.0, z: 0.3, rx: -0.6, ry: 0, rz: 0.1 },
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
    x: -7,
    z: 4,
    hand: { x: 0.3, y: 1.0, z: 0.4, rx: 0, ry: 0, rz: 0 },
  },
];

/** 起始武器 id */
export const START_WEAPON = 'sword';
