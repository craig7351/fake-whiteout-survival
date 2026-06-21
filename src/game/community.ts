/**
 * 社群資料（排行榜／留言板／線上人數／累計統計）。
 * 目前為「離線優先」純本機版（localStorage）；之後可接後端 /api/* 變成全球共享
 *（架構參考 animal-survivors：前端先打 API，失敗回退本機）。
 */
const TOTALS_KEY = 'fake-whiteout:totals';
const LB_KEY = 'fake-whiteout:leaderboard';
const MSG_KEY = 'fake-whiteout:messages';
const NAME_KEY = 'fake-whiteout:name';
const DEVICE_KEY = 'fake-whiteout:deviceId';

/** 後端 API 同源 /api（部署 Cloudflare Pages Functions 後生效；本機 dev 無 /api 則自動回退本機） */
const BASE = '/api';
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
/** fire-and-forget POST（離線/失敗忽略） */
function post(path: string, body: unknown) {
  try {
    void fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(body as object), deviceId: deviceId() }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
async function getJSON<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

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
  opens?: number; // 遊戲被開啟次數
}
export function getTotals(): Totals {
  return { money: 0, cows: 0, monsters: 0, runs: 0, opens: 0, ...read<Partial<Totals>>(TOTALS_KEY, {}) };
}
/** 遊戲被開啟一次（首頁載入時呼叫）：後端累計 + 本機備援 */
export function recordOpen() {
  const o = Number(localStorage.getItem('fake-whiteout:opens') ?? '0') + 1;
  try {
    localStorage.setItem('fake-whiteout:opens', String(o));
  } catch {
    /* ignore */
  }
  post('/open', {});
}
/** 最近 24 小時每小時在線尖峰（後端）；失敗回 null */
export const fetchOnlineHistory = () => getJSON<{ at: number; peak: number }[]>('/online-history');
export function addTotals(d: Partial<Totals>) {
  const t = getTotals();
  write(TOTALS_KEY, {
    money: t.money + (d.money ?? 0),
    cows: t.cows + (d.cows ?? 0),
    monsters: t.monsters + (d.monsters ?? 0),
    runs: t.runs + (d.runs ?? 0),
  });
  post('/totals', { money: d.money ?? 0, cows: d.cows ?? 0, monsters: d.monsters ?? 0, runs: d.runs ?? 0 });
}
/** 全服累計（後端）；失敗回 null */
export const fetchTotals = () => getJSON<Totals>('/totals');

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
  post('/run', { name: r.name, wave: r.wave, money: r.money, won: r.won });
}
/** 全球排行榜（後端）；失敗回 null */
export const fetchLeaderboard = (limit = 10) => getJSON<RunRec[]>(`/leaderboard?limit=${limit}`);

/* ===== 留言板 ===== */
export interface Msg {
  id?: number; // 後端留言才有；本機留言無
  name: string;
  text: string;
  at: number;
  parentId?: number | null; // 有值＝回覆某則留言
  replies?: Msg[]; // 前端組串用（非儲存）
}
export function getMessages(): Msg[] {
  return read<Msg[]>(MSG_KEY, []).slice(-80).reverse();
}
/** 發表留言（parentId 有值＝回覆） */
export function postMessage(name: string, text: string, parentId?: number | null) {
  const t = text.trim().slice(0, 120);
  if (!t) return;
  const nm = name.trim().slice(0, 12) || '匿名';
  const all = read<Msg[]>(MSG_KEY, []);
  all.push({ name: nm, text: t, at: Date.now(), parentId: parentId ?? null });
  write(MSG_KEY, all.slice(-200));
  post('/messages', { name: nm, text: t, parentId: parentId ?? null });
}
/** 全球留言（後端）；失敗回 null */
export const fetchMessages = () => getJSON<Msg[]>('/messages');
/** 把扁平留言組成「主留言 + 回覆」串（主留言新到舊，回覆舊到新） */
export function threadMessages(flat: Msg[]): Msg[] {
  const byId = new Map<number, Msg>();
  const tops: Msg[] = [];
  // 先建立節點（複製，附空 replies）
  const nodes = flat.map((m) => ({ ...m, replies: [] as Msg[] }));
  for (const n of nodes) if (n.id != null) byId.set(n.id, n);
  for (const n of nodes) {
    if (n.parentId != null && byId.has(n.parentId)) byId.get(n.parentId)!.replies!.push(n);
    else tops.push(n);
  }
  // 主留言：新到舊（id 大在前）；回覆：舊到新
  tops.sort((a, b) => (b.id ?? b.at) - (a.id ?? a.at));
  for (const t of tops) t.replies!.sort((a, b) => (a.id ?? a.at) - (b.id ?? b.at));
  return tops;
}
/** 版主刪除留言（需正確 key）；成功回 true */
export async function deleteMessage(id: number, key: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/messages`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, key }),
    });
    return res.ok;
  } catch {
    return false;
  }
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

/* ===== 線上人數 ===== */
/** 本機離線預設值 */
export function getOnline(): number {
  return 1;
}
/** 後端線上人數；失敗回 null */
export const fetchOnline = () => getJSON<{ online: number }>('/online');
/** 心跳上報（在線標記） */
export function sendHeartbeat() {
  post('/heartbeat', {});
}
