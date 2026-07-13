<template>
  <div class="landing relative h-full w-full overflow-y-auto overflow-x-hidden">
    <!-- 背景：冰藍漸層 + 極光光暈 + 飄雪 -->
    <div class="bg-base fixed inset-0" />
    <div class="bg-aurora fixed inset-0" />
    <div class="pointer-events-none fixed inset-0 overflow-hidden">
      <span
        v-for="(f, i) in flakes"
        :key="i"
        class="flake"
        :style="{
          left: f.left + '%',
          width: f.size + 'px',
          height: f.size + 'px',
          '--dur': f.dur + 's',
          '--delay': f.delay + 's',
          '--drift': f.drift + 'px',
          '--op': f.op,
        }"
      />
    </div>

    <div class="relative z-10 mx-auto flex min-h-full w-full max-w-md flex-col items-center px-5 py-9 text-center">
      <!-- 標題 -->
      <h1 class="title-text">
        <span class="title-fake">偽</span>寒冰啟示錄
      </h1>
      <p class="mb-2 text-[11px] font-bold tracking-[0.35em] text-cyan-200/70">FAKE WHITEOUT SURVIVAL</p>
      <p class="mb-6 max-w-xs text-xs leading-relaxed text-slate-300/80">
        經營肉舖 → 擴張牧場 → 蓋房子 → 蓋塔守城,撐過 30 波
      </p>

      <!-- 線上人數 -->
      <div class="mb-4 flex w-full items-center justify-center text-xs">
        <span class="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-bold text-emerald-200">
          <span class="relative flex h-2 w-2">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          線上 {{ online }} 人
        </span>
      </div>

      <!-- 玩家姓名（必填才能開始） -->
      <input
        v-model="name"
        @change="onName"
        maxlength="12"
        placeholder="輸入你的名字"
        class="glass mb-2 w-full rounded-xl px-4 py-2.5 text-center text-base font-bold text-slate-100 outline-none placeholder:text-slate-400"
      />

      <!-- 主 CTA -->
      <button
        class="play-btn mb-2 w-full"
        :class="{ 'cursor-not-allowed opacity-50': !canStart }"
        :disabled="!canStart"
        @click="onStart"
      >
        <span class="relative z-10">▶ 立即遊玩</span>
      </button>
      <p v-if="!canStart" class="mb-3 text-xs font-bold text-rose-300/90">請先輸入你的名字才能開始</p>
      <div v-else class="mb-3" />

      <!-- 功能按鈕：排行榜 / 成就 / 留言板 / 線上人數 -->
      <div class="mb-5 grid w-full grid-cols-2 gap-2.5">
        <button class="menu-btn" @click="open('leaderboard')">
          <span class="text-2xl drop-shadow">🏆</span><span>排行榜</span>
        </button>
        <button class="menu-btn" @click="open('achievements')">
          <span class="text-2xl drop-shadow">🏅</span>
          <span>成就 <span class="text-[10px] font-bold text-cyan-300/70">{{ unlockedCount }}/{{ achievements.length }}</span></span>
        </button>
        <button class="menu-btn" @click="open('messages')">
          <span class="text-2xl drop-shadow">💬</span><span>留言板</span>
        </button>
        <button class="menu-btn" @click="open('online')">
          <span class="text-2xl drop-shadow">📈</span><span>線上人數</span>
        </button>
      </div>

      <!-- 介紹頁 + 粉絲團 -->
      <a
        href="https://craig7351.github.io/fake-whiteout-survival/"
        target="_blank"
        rel="noopener"
        class="glass mb-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black text-cyan-100 transition hover:bg-white/10 active:scale-95"
      >
        <span class="text-lg">📰</span> 遊戲介紹頁
      </a>
      <a
        href="https://www.facebook.com/people/Book-Ai/61584339789020/"
        target="_blank"
        rel="noopener"
        class="mb-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1877f2] py-2.5 text-sm font-black text-white shadow-lg transition hover:bg-[#3b8bf5] active:scale-95"
      >
        <span class="text-lg">👍</span> 追蹤 Book Ai 粉絲團
      </a>

      <!-- 全服累計統計 -->
      <div class="grid w-full grid-cols-2 gap-2.5">
        <div class="glass stat-card">
          <div class="text-xl font-black text-amber-300">💰 {{ fmt(totals.money) }}</div>
          <div class="stat-label">總共賺到</div>
        </div>
        <div class="glass stat-card">
          <div class="text-xl font-black text-rose-300">🐄 {{ fmt(totals.cows) }}</div>
          <div class="stat-label">擊殺牛隻</div>
        </div>
        <div class="glass stat-card">
          <div class="text-xl font-black text-lime-300">🧟 {{ fmt(totals.monsters) }}</div>
          <div class="stat-label">擊殺怪物</div>
        </div>
        <div class="glass stat-card">
          <div class="text-xl font-black text-sky-300">🎮 {{ fmt(totals.runs) }}</div>
          <div class="stat-label">遊玩場次</div>
        </div>
      </div>
    </div>

    <!-- ===== 彈窗 ===== -->
    <div
      v-if="panel"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md"
      @click.self="close"
    >
      <div class="modal-card flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden">
        <!-- 標題列 -->
        <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div class="text-base font-black text-slate-100">{{ panelTitle }}</div>
          <button class="rounded-full px-2 py-0.5 text-xl text-slate-400 transition hover:bg-white/10 hover:text-slate-100" @click="close">✕</button>
        </div>

        <!-- 內容 -->
        <div class="flex-1 overflow-y-auto p-4 text-left">
          <!-- 排行榜 -->
          <template v-if="panel === 'leaderboard'">
            <div v-if="leaderboard.length" class="flex flex-col gap-1.5">
              <div v-for="(r, i) in leaderboard" :key="i" class="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-sm">
                <span class="w-6 text-center font-black" :class="i < 3 ? 'text-amber-300' : 'text-slate-500'">{{ i + 1 }}</span>
                <span class="flex-1 truncate font-bold text-slate-200">{{ r.name }} <span v-if="r.won">🏆</span></span>
                <span class="font-black text-rose-300">第 {{ r.wave }} 波</span>
                <span class="w-16 text-right text-amber-300">💰{{ fmt(r.money) }}</span>
              </div>
            </div>
            <div v-else class="py-6 text-center text-sm text-slate-500">還沒有紀錄,快去玩第一場!</div>
          </template>

          <!-- 最近 7 天每日上線人數（折線圖） -->
          <template v-else-if="panel === 'online'">
            <div class="mb-3 text-center text-sm text-cyan-200">目前線上 <b class="text-emerald-300">{{ online }}</b> 人 · 最近 7 天每日尖峰</div>
            <div v-if="chart.pts.length" class="rounded-lg bg-white/5 p-3">
              <svg :viewBox="`0 0 ${chart.W} ${chart.H}`" class="w-full">
                <polyline :points="chart.poly" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
                <g v-for="(p, i) in chart.pts" :key="i">
                  <circle :cx="p.x" :cy="p.y" r="3.5" fill="#7dd3fc" />
                  <text :x="p.x" :y="p.y - 7" fill="#cfe6ff" font-size="10" font-weight="bold" text-anchor="middle">{{ p.peak }}</text>
                  <text :x="p.x" :y="chart.H - 3" fill="#9fb6cc" font-size="9" text-anchor="middle">{{ p.label }}</text>
                </g>
              </svg>
            </div>
            <div v-else class="py-6 text-center text-sm text-slate-500">還沒有歷史資料,等大家上線後就會逐日記錄</div>
          </template>

          <!-- 成就 -->
          <template v-else-if="panel === 'achievements'">
            <div class="grid grid-cols-2 gap-1.5">
              <div
                v-for="a in achievements"
                :key="a.id"
                class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left ring-1"
                :class="a.got ? 'bg-amber-400/15 ring-amber-300/40' : 'bg-white/5 ring-white/10 opacity-50'"
              >
                <span class="text-lg">{{ a.got ? a.emoji : '🔒' }}</span>
                <div class="min-w-0">
                  <div class="truncate text-xs font-black" :class="a.got ? 'text-amber-100' : 'text-slate-400'">{{ a.name }}</div>
                  <div class="truncate text-[10px]" :class="a.got ? 'text-slate-300' : 'text-slate-500'">{{ a.desc }}</div>
                </div>
              </div>
            </div>
          </template>

          <!-- 留言板 -->
          <template v-else-if="panel === 'messages'">
            <div class="mb-3 flex flex-col gap-1">
              <input
                v-model="name"
                @change="onName"
                maxlength="12"
                placeholder="你的名字"
                class="w-full rounded-lg bg-white/10 px-2 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-white/15 placeholder:text-slate-500"
              />
              <div class="flex gap-1">
                <input
                  v-model="msgText"
                  maxlength="120"
                  placeholder="留個言…"
                  class="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-white/15 placeholder:text-slate-500"
                  @keydown.enter="onPost"
                />
                <button class="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-black text-white transition hover:bg-cyan-400 active:scale-95" @click="onPost">送出</button>
              </div>
            </div>
            <div v-if="threads.length" class="flex flex-col gap-2">
              <div v-for="m in threads" :key="m.id ?? m.at" class="rounded-lg bg-white/5 px-2 py-1.5 text-xs">
                <!-- 主留言 -->
                <div class="flex items-start gap-1">
                  <div class="min-w-0 flex-1">
                    <span class="font-black text-cyan-300">{{ m.name }}</span>
                    <span class="ml-1 break-words text-slate-200">{{ m.text }}</span>
                  </div>
                  <button v-if="m.id" class="shrink-0 px-1 text-[11px] font-bold text-slate-400 hover:text-cyan-300" @click="toggleReply(m.id)">回覆</button>
                  <button v-if="m.id" class="shrink-0 px-1 text-slate-500 hover:text-rose-400" title="版主刪除" @click="onDelete(m)">✕</button>
                </div>
                <!-- 回覆們 -->
                <div v-if="m.replies && m.replies.length" class="mt-1 flex flex-col gap-1 border-l-2 border-cyan-300/20 pl-2">
                  <div v-for="r in m.replies" :key="r.id ?? r.at" class="flex items-start gap-1">
                    <div class="min-w-0 flex-1">
                      <span class="font-black text-sky-300">↳ {{ r.name }}</span>
                      <span class="ml-1 break-words text-slate-300">{{ r.text }}</span>
                    </div>
                    <button v-if="r.id" class="shrink-0 px-1 text-slate-500 hover:text-rose-400" title="版主刪除" @click="onDelete(r)">✕</button>
                  </div>
                </div>
                <!-- 回覆輸入 -->
                <div v-if="replyTo === m.id" class="mt-1.5 flex gap-1">
                  <input
                    v-model="replyText"
                    maxlength="120"
                    placeholder="回覆…"
                    class="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-white/15 placeholder:text-slate-500"
                    @keydown.enter="m.id != null && onReply(m.id)"
                  />
                  <button class="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-black text-white active:scale-95" @click="m.id != null && onReply(m.id)">送出</button>
                </div>
              </div>
            </div>
            <div v-else class="py-6 text-center text-sm text-slate-500">還沒有留言,搶頭香!</div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { ACHIEVEMENTS, loadAchievements } from '../game/achievements';
import {
  getTotals,
  getLeaderboard,
  getMessages,
  postMessage,
  setName,
  getOnline,
  fetchTotals,
  fetchLeaderboard,
  fetchMessages,
  fetchOnline,
  fetchOnlineHistory,
  enterOnline,
  deleteMessage,
  threadMessages,
  type Msg,
} from '../game/community';

const emit = defineEmits<{ (e: 'start'): void }>();

const unlocked = loadAchievements();
const achievements = ACHIEVEMENTS.map((a) => ({ ...a, got: unlocked.has(a.id) }));
const unlockedCount = computed(() => achievements.filter((a) => a.got).length);

/** 飄雪：一次性隨機產生，純 CSS 動畫 */
const flakes = Array.from({ length: 32 }, () => ({
  left: Math.random() * 100,
  size: 2 + Math.random() * 4,
  dur: 7 + Math.random() * 11,
  delay: -Math.random() * 14,
  drift: (Math.random() * 2 - 1) * 50,
  op: 0.25 + Math.random() * 0.5,
}));

/** 先顯示本機資料,再用後端(若有部署)覆蓋 */
const totals = ref(getTotals());
const leaderboard = ref(getLeaderboard(10));
const online = ref(getOnline());
/** 直接讀已存的名字（不自動產生預設）→ 新玩家為空、強制輸入才能開始 */
const name = ref(localStorage.getItem('fake-whiteout:name') ?? '');
const messages = ref(getMessages());
const msgText = ref('');
/** 留言串（主留言 + 回覆） */
const threads = computed(() => threadMessages(messages.value));
/** 目前展開回覆輸入的留言 id */
const replyTo = ref<number | null>(null);
const replyText = ref('');

/** 彈窗：null=關閉 */
type Panel = 'leaderboard' | 'achievements' | 'messages' | 'online';
const panel = ref<Panel | null>(null);
const onlineHistory = ref<{ at: number; peak: number }[]>([]);
const panelTitle = computed(() =>
  panel.value === 'leaderboard'
    ? '🏆 排行榜（撐最久）'
    : panel.value === 'achievements'
      ? '🏅 成就'
      : panel.value === 'online'
        ? '📈 最近 7 天上線人數'
        : '💬 留言板',
);
function open(p: Panel) {
  panel.value = p;
  void refresh();
  if (p === 'online') void fetchOnlineHistory().then((h) => h && (onlineHistory.value = h));
}
function close() {
  panel.value = null;
}

async function refresh() {
  const [t, lb, msg, on] = await Promise.all([fetchTotals(), fetchLeaderboard(10), fetchMessages(), fetchOnline()]);
  if (t) totals.value = t;
  if (lb) leaderboard.value = lb;
  if (msg) messages.value = msg;
  if (on) online.value = on.online;
}

onMounted(() => {
  void enterOnline().then((o) => o && (online.value = o.online));   // 進場記錄 + 取人數（僅一次，不再輪詢）
  void refresh();
});

function fmt(n: number) {
  return n.toLocaleString();
}
/** 最近 7 天每日上線：折線圖座標 */
function dayLabel(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const chart = computed(() => {
  const data = onlineHistory.value;
  const W = 300;
  const H = 120;
  const padX = 22;
  const padY = 20;
  const max = Math.max(1, ...data.map((d) => d.peak));
  const n = data.length;
  const pts = data.map((d, i) => {
    const x = n <= 1 ? W / 2 : padX + (i / (n - 1)) * (W - 2 * padX);
    const y = padY + (1 - d.peak / max) * (H - 2 * padY);
    return { x, y, peak: d.peak, label: dayLabel(d.at) };
  });
  return { W, H, max, pts, poly: pts.map((p) => `${p.x},${p.y}`).join(' ') };
});
function onName() {
  setName(name.value); // 只儲存，不回填預設（讓欄位可為空以擋住開始）
}
/** 必填姓名才能開始 */
const canStart = computed(() => name.value.trim().length > 0);
function onStart() {
  if (!canStart.value) return;
  setName(name.value);
  emit('start');
}
function refreshMessages() {
  messages.value = getMessages();
  void fetchMessages().then((m) => {
    if (m) messages.value = m;
  });
}
function onPost() {
  if (!msgText.value.trim()) return;
  postMessage(name.value, msgText.value);
  msgText.value = '';
  refreshMessages();
}
function toggleReply(id: number) {
  replyTo.value = replyTo.value === id ? null : id;
  replyText.value = '';
}
function onReply(parentId: number) {
  if (!replyText.value.trim()) return;
  postMessage(name.value, replyText.value, parentId);
  replyText.value = '';
  replyTo.value = null;
  refreshMessages();
}

const ADMIN_KEY_LS = 'fake-whiteout:adminKey';
async function onDelete(m: Msg) {
  if (!m.id) return;
  let key = localStorage.getItem(ADMIN_KEY_LS) || '';
  if (!key) {
    key = window.prompt('輸入版主刪除碼（提示：8bytes生日）：') || '';
    if (!key) return;
  }
  const ok = await deleteMessage(m.id, key);
  if (ok) {
    localStorage.setItem(ADMIN_KEY_LS, key);
    const fresh = await fetchMessages();
    if (fresh) messages.value = fresh;
  } else {
    localStorage.removeItem(ADMIN_KEY_LS);
    window.alert('刪除失敗（刪除碼錯誤或無權限）');
  }
}
</script>

<style scoped>
/* 背景：深寒冰漸層 */
.bg-base {
  background: linear-gradient(180deg, #06182c 0%, #0c2c45 45%, #14455f 100%);
}
/* 極光光暈 */
.bg-aurora {
  background:
    radial-gradient(60% 45% at 18% 12%, rgba(56, 189, 248, 0.28), transparent 70%),
    radial-gradient(55% 40% at 88% 88%, rgba(129, 140, 248, 0.22), transparent 70%),
    radial-gradient(45% 35% at 50% 50%, rgba(45, 212, 191, 0.12), transparent 70%);
  filter: blur(2px);
}

/* 飄雪 */
.flake {
  position: absolute;
  top: -6vh;
  border-radius: 9999px;
  background: white;
  opacity: var(--op);
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.6);
  animation: snowfall var(--dur) linear var(--delay) infinite;
}
@keyframes snowfall {
  0% { transform: translate(0, 0); }
  100% { transform: translate(var(--drift), 112vh); }
}

/* 標題 */
.title-text {
  font-size: 2.6rem;
  line-height: 1.05;
  font-weight: 900;
  letter-spacing: 0.06em;
  background: linear-gradient(180deg, #ffffff 0%, #bae6fd 55%, #7dd3fc 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 4px 24px rgba(56, 189, 248, 0.35);
}
@media (min-width: 640px) {
  .title-text { font-size: 3.2rem; }
}
.title-fake {
  -webkit-text-fill-color: #fb7185;
  font-size: 0.62em;
  vertical-align: 0.18em;
  margin-right: 0.06em;
  text-shadow: 0 2px 10px rgba(251, 113, 133, 0.5);
}

/* 毛玻璃通用 */
.glass {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(10px);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset, 0 8px 24px rgba(2, 12, 24, 0.35);
}

/* 統計卡 */
.stat-card {
  border-radius: 0.9rem;
  padding: 0.6rem 0.5rem;
}
.stat-label {
  margin-top: 0.1rem;
  font-size: 10px;
  color: rgba(203, 213, 225, 0.7);
}

/* 主 CTA */
.play-btn {
  position: relative;
  overflow: hidden;
  border-radius: 1.1rem;
  padding: 1.05rem 1rem;
  font-size: 1.6rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: #042231;
  background: linear-gradient(135deg, #67e8f9 0%, #38bdf8 50%, #3b82f6 100%);
  border: 1px solid rgba(186, 230, 253, 0.6);
  box-shadow: 0 10px 30px rgba(56, 189, 248, 0.45), 0 0 0 0 rgba(56, 189, 248, 0.5);
  transition: transform 0.16s, box-shadow 0.16s, filter 0.16s;
}
.play-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.35), transparent 45%);
}
.play-btn:hover {
  filter: brightness(1.06);
  transform: translateY(-2px);
  box-shadow: 0 16px 40px rgba(56, 189, 248, 0.6);
}
.play-btn:active {
  transform: scale(0.98);
}

/* 功能按鈕 */
.menu-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  padding: 0.7rem 0.25rem;
  border-radius: 0.9rem;
  font-weight: 900;
  font-size: 0.82rem;
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(10px);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset, 0 8px 20px rgba(2, 12, 24, 0.35);
  transition: transform 0.15s, background 0.15s, border-color 0.15s;
}
.menu-btn:hover {
  background: rgba(56, 189, 248, 0.16);
  border-color: rgba(125, 211, 252, 0.5);
  transform: translateY(-3px);
}
.menu-btn:active {
  transform: scale(0.96);
}

/* 彈窗卡片 */
.modal-card {
  border-radius: 1.1rem;
  background: rgba(11, 27, 43, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
</style>
