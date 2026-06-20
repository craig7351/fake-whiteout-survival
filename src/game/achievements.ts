/** 成就系統：解鎖狀態存在 localStorage，首頁顯示成就表 */
export interface AchievementDef {
  id: string;
  emoji: string;
  name: string;
  desc: string;
}

/** 成就清單（顯示順序＝難度由淺到深） */
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'sell', emoji: '🥩', name: '第一筆生意', desc: '賣出肉賺到錢' },
  { id: 'rich', emoji: '💰', name: '小富翁', desc: '累積賺到 $2000' },
  { id: 'dog', emoji: '🐕', name: '好幫手', desc: '雇用牧羊犬' },
  { id: 'hunter', emoji: '🏹', name: '獵人上工', desc: '雇用獵人' },
  { id: 'cashier', emoji: '🧑‍💼', name: '收銀無憂', desc: '雇用收銀員' },
  { id: 'pasture2', emoji: '🧨', name: '開疆闢土', desc: '炸開牧場 2' },
  { id: 'house', emoji: '🛡️', name: '備戰開始', desc: '開啟塔防戰' },
  { id: 'boss', emoji: '👹', name: '屠魔者', desc: '擊殺第一隻 Boss' },
  { id: 'wave10', emoji: '🛡️', name: '守城新手', desc: '撐過第 10 波' },
  { id: 'wave20', emoji: '⚔️', name: '守城好手', desc: '撐過第 20 波' },
  { id: 'win', emoji: '🏆', name: '通關！', desc: '撐過第 30 波破關' },
];

const KEY = 'fake-whiteout:achievements';

export function loadAchievements(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return new Set<string>();
  }
}

/** 解鎖一個成就（已解鎖則略過），回傳是否為「首次解鎖」 */
export function unlockAchievement(id: string): boolean {
  const s = loadAchievements();
  if (s.has(id)) return false;
  s.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
  return true;
}
