/**
 * 社群資料（排行榜／留言板／線上人數／累計統計）。
 * 目前為「離線優先」純本機版（localStorage）；之後可接後端 /api/* 變成全球共享
 *（架構參考 animal-survivors：前端先打 API，失敗回退本機）。
 */
const TOTALS_KEY = 'fake-whiteout:totals';
const LB_KEY = 'fake-whiteout:leaderboard';
const MSG_KEY = 'fake-whiteout:messages';
const NAME_KEY = 'fake-whiteout:name';

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/* ===== 累計統計 ===== */
export interface Totals {
  money: number; // 總共賺到的錢
  cows: number; // 殺了多少牛
  monsters: number; // 殺了多少怪物（殭屍）
  runs: number; // 遊玩場次
}
export function getTotals(): Totals {
  return { money: 0, cows: 0, monsters: 0, runs: 0, ...read<Partial<Totals>>(TOTALS_KEY, {}) };
}
export function addTotals(d: Partial<Totals>) {
  const t = getTotals();
  write(TOTALS_KEY, {
    money: t.money + (d.money ?? 0),
    cows: t.cows + (d.cows ?? 0),
    monsters: t.monsters + (d.monsters ?? 0),
    runs: t.runs + (d.runs ?? 0),
  });
}

/* ===== 排行榜 ===== */
export interface RunRec {
  name: string;
  wave: number; // 撐到第幾波
  money: number; // 本場賺多少
  won: boolean; // 是否通關
  at: number;
}
const byScore = (a: RunRec, b: RunRec) => b.wave - a.wave || b.money - a.money;
export function getLeaderboard(limit = 10): RunRec[] {
  return read<RunRec[]>(LB_KEY, []).sort(byScore).slice(0, limit);
}
export function submitRun(r: RunRec) {
  const all = read<RunRec[]>(LB_KEY, []);
  all.push(r);
  write(LB_KEY, all.sort(byScore).slice(0, 50));
}

/* ===== 留言板 ===== */
export interface Msg {
  name: string;
  text: string;
  at: number;
}
export function getMessages(): Msg[] {
  return read<Msg[]>(MSG_KEY, []).slice(-60).reverse();
}
export function postMessage(name: string, text: string) {
  const t = text.trim().slice(0, 120);
  if (!t) return;
  const all = read<Msg[]>(MSG_KEY, []);
  all.push({ name: name.trim().slice(0, 12) || '匿名', text: t, at: Date.now() });
  write(MSG_KEY, all.slice(-200));
}

/* ===== 玩家暱稱 ===== */
export function getName(): string {
  let n = localStorage.getItem(NAME_KEY);
  if (!n) {
    n = '玩家' + Math.floor(Math.random() * 900 + 100);
    localStorage.setItem(NAME_KEY, n);
  }
  return n;
}
export function setName(n: string) {
  localStorage.setItem(NAME_KEY, n.trim().slice(0, 12) || '玩家');
}

/* ===== 線上人數（本機離線版：只有你） ===== */
export function getOnline(): number {
  return 1;
}
