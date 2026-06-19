<template>
  <div class="relative h-full w-full overflow-y-auto overflow-x-hidden">
    <!-- 雪地漸層背景 -->
    <div class="fixed inset-0 bg-gradient-to-b from-[#9fb8d8] to-[#e9eef6]" />

    <div class="relative z-10 mx-auto flex min-h-full w-full max-w-md flex-col items-center px-5 py-8 text-center">
      <div class="mb-1 text-6xl">🥩❄️</div>
      <h1 class="text-4xl font-black text-slate-800 drop-shadow sm:text-5xl">雪地肉舖</h1>
      <p class="mb-1 text-xs font-bold tracking-widest text-slate-600">FAKE WHITEOUT SURVIVAL</p>
      <p class="mb-5 max-w-xs text-xs text-slate-500">經營肉舖 → 擴張牧場 → 蓋房子 → 蓋塔守城,撐過 30 波破關!</p>

      <!-- 線上人數 + 暱稱 -->
      <div class="mb-3 flex w-full items-center justify-between gap-2 text-xs">
        <span class="rounded-full bg-emerald-500/15 px-3 py-1 font-bold text-emerald-700">🟢 線上 {{ online }} 人</span>
        <label class="flex items-center gap-1 text-slate-500">
          暱稱
          <input
            v-model="name"
            @change="onName"
            maxlength="12"
            class="w-24 rounded-md bg-white/70 px-2 py-1 text-slate-800 outline-none ring-1 ring-slate-300"
          />
        </label>
      </div>

      <button
        class="mb-5 w-full rounded-2xl bg-emerald-500 py-4 text-2xl font-black text-white shadow-xl ring-2 ring-emerald-300/50 transition hover:bg-emerald-400 active:scale-95"
        @click="emit('start')"
      >
        立即遊玩
      </button>

      <!-- 全服累計統計 -->
      <div class="mb-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded-xl bg-white/55 p-2 ring-1 ring-white/50">
          <div class="text-lg font-black text-amber-600">💰 {{ fmt(totals.money) }}</div>
          <div class="text-[10px] text-slate-500">總共賺到</div>
        </div>
        <div class="rounded-xl bg-white/55 p-2 ring-1 ring-white/50">
          <div class="text-lg font-black text-rose-600">🐄 {{ fmt(totals.cows) }}</div>
          <div class="text-[10px] text-slate-500">擊殺牛隻</div>
        </div>
        <div class="rounded-xl bg-white/55 p-2 ring-1 ring-white/50">
          <div class="text-lg font-black text-lime-700">🧟 {{ fmt(totals.monsters) }}</div>
          <div class="text-[10px] text-slate-500">擊殺怪物</div>
        </div>
        <div class="rounded-xl bg-white/55 p-2 ring-1 ring-white/50">
          <div class="text-lg font-black text-sky-600">🎮 {{ fmt(totals.runs) }}</div>
          <div class="text-[10px] text-slate-500">遊玩場次</div>
        </div>
      </div>

      <!-- 排行榜 -->
      <div class="mb-4 w-full rounded-2xl bg-white/55 p-3 text-left ring-1 ring-white/50">
        <div class="mb-2 text-sm font-black text-slate-700">🏆 排行榜（撐最久）</div>
        <div v-if="leaderboard.length" class="flex flex-col gap-1">
          <div v-for="(r, i) in leaderboard" :key="i" class="flex items-center gap-2 text-xs">
            <span class="w-5 text-center font-black" :class="i < 3 ? 'text-amber-600' : 'text-slate-400'">{{ i + 1 }}</span>
            <span class="flex-1 truncate font-bold text-slate-700">{{ r.name }} <span v-if="r.won">🏆</span></span>
            <span class="font-black text-rose-600">第 {{ r.wave }} 波</span>
            <span class="w-16 text-right text-amber-600">💰{{ fmt(r.money) }}</span>
          </div>
        </div>
        <div v-else class="py-2 text-center text-xs text-slate-400">還沒有紀錄，快去玩第一場！</div>
      </div>

      <!-- 成就 -->
      <div class="mb-4 w-full rounded-2xl bg-white/55 p-3 ring-1 ring-white/50">
        <div class="mb-2 flex items-center justify-center gap-2 text-sm font-black text-slate-700">
          🏅 成就 <span class="rounded-full bg-slate-800/10 px-2 py-0.5 text-xs">{{ unlockedCount }} / {{ achievements.length }}</span>
        </div>
        <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <div
            v-for="a in achievements"
            :key="a.id"
            class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left ring-1"
            :class="a.got ? 'bg-amber-100/90 ring-amber-300' : 'bg-white/40 ring-white/40 opacity-55'"
          >
            <span class="text-lg">{{ a.got ? a.emoji : '🔒' }}</span>
            <div class="min-w-0">
              <div class="truncate text-xs font-black" :class="a.got ? 'text-slate-800' : 'text-slate-500'">{{ a.name }}</div>
              <div class="truncate text-[10px]" :class="a.got ? 'text-slate-600' : 'text-slate-400'">{{ a.desc }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 留言板 -->
      <div class="w-full rounded-2xl bg-white/55 p-3 text-left ring-1 ring-white/50">
        <div class="mb-2 text-sm font-black text-slate-700">💬 留言板</div>
        <div class="mb-2 flex gap-1">
          <input
            v-model="msgText"
            maxlength="120"
            placeholder="留個言…"
            class="min-w-0 flex-1 rounded-lg bg-white/80 px-2 py-1.5 text-xs text-slate-800 outline-none ring-1 ring-slate-300"
            @keydown.enter="onPost"
          />
          <button class="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-black text-white active:scale-95" @click="onPost">送出</button>
        </div>
        <div v-if="messages.length" class="flex max-h-44 flex-col gap-1.5 overflow-y-auto">
          <div v-for="(m, i) in messages" :key="i" class="group flex items-start gap-1 rounded-lg bg-white/60 px-2 py-1.5 text-xs">
            <div class="min-w-0 flex-1">
              <span class="font-black text-sky-700">{{ m.name }}</span>
              <span class="ml-1 break-words text-slate-700">{{ m.text }}</span>
            </div>
            <button
              v-if="m.id"
              class="shrink-0 px-1 text-slate-300 hover:text-rose-500"
              title="版主刪除"
              @click="onDelete(m)"
            >
              ✕
            </button>
          </div>
        </div>
        <div v-else class="py-2 text-center text-xs text-slate-400">還沒有留言，搶頭香！</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { ACHIEVEMENTS, loadAchievements } from '../game/achievements';
import {
  getTotals,
  getLeaderboard,
  getMessages,
  postMessage,
  getName,
  setName,
  getOnline,
  fetchTotals,
  fetchLeaderboard,
  fetchMessages,
  fetchOnline,
  sendHeartbeat,
  deleteMessage,
  type Msg,
} from '../game/community';

const emit = defineEmits<{ (e: 'start'): void }>();

const unlocked = loadAchievements();
const achievements = ACHIEVEMENTS.map((a) => ({ ...a, got: unlocked.has(a.id) }));
const unlockedCount = computed(() => achievements.filter((a) => a.got).length);

/** 先顯示本機資料，再用後端（若有部署）覆蓋 */
const totals = ref(getTotals());
const leaderboard = ref(getLeaderboard(10));
const online = ref(getOnline());
const name = ref(getName());
const messages = ref(getMessages());
const msgText = ref('');
let hbTimer: number | undefined;

async function refresh() {
  const [t, lb, msg, on] = await Promise.all([fetchTotals(), fetchLeaderboard(10), fetchMessages(), fetchOnline()]);
  if (t) totals.value = t;
  if (lb) leaderboard.value = lb;
  if (msg) messages.value = msg;
  if (on) online.value = on.online;
}

onMounted(() => {
  sendHeartbeat();
  void refresh();
  hbTimer = window.setInterval(() => {
    sendHeartbeat();
    void refresh();
  }, 60000);
});
onUnmounted(() => {
  if (hbTimer !== undefined) clearInterval(hbTimer);
});

function fmt(n: number) {
  return n.toLocaleString();
}
function onName() {
  setName(name.value);
  name.value = getName();
}
function onPost() {
  if (!msgText.value.trim()) return;
  postMessage(name.value, msgText.value);
  msgText.value = '';
  messages.value = getMessages();
  void fetchMessages().then((m) => {
    if (m) messages.value = m;
  });
}

const ADMIN_KEY_LS = 'fake-whiteout:adminKey';
async function onDelete(m: Msg) {
  if (!m.id) return; // 本機留言不可刪
  let key = localStorage.getItem(ADMIN_KEY_LS) || '';
  if (!key) {
    key = window.prompt('輸入版主刪除碼（提示：8bytes生日）：') || '';
    if (!key) return;
  }
  const ok = await deleteMessage(m.id, key);
  if (ok) {
    localStorage.setItem(ADMIN_KEY_LS, key); // 記住正確的 key
    const fresh = await fetchMessages();
    if (fresh) messages.value = fresh;
  } else {
    localStorage.removeItem(ADMIN_KEY_LS);
    window.alert('刪除失敗（刪除碼錯誤或無權限）');
  }
}
</script>
