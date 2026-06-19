<template>
  <div class="relative h-full w-full overflow-hidden bg-[#0b1020]">
    <canvas ref="canvasRef" class="block h-full w-full outline-none touch-none" />

    <hud :stats="stats" />

    <!-- 左上：靜音 + Debug（小圖示，讓出右上給金錢） -->
    <div class="absolute left-3 top-3 z-10 flex items-center gap-2" :style="safeTop">
      <button
        class="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-xl text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95"
        @click="onToggleMute"
      >
        {{ muted ? '🔇' : '🔊' }}
      </button>
      <button
        class="flex h-11 w-11 items-center justify-center rounded-full text-xl text-white backdrop-blur-md transition active:scale-95"
        :class="showDebug ? 'bg-fuchsia-500' : 'bg-black/40 hover:bg-black/60'"
        @click="showDebug = !showDebug"
      >
        🛠️
      </button>
      <!-- FPS（放在此排，永遠在 debug 面板之上、不被遮住） -->
      <span
        class="flex h-11 items-center rounded-full bg-black/40 px-3 text-sm font-black backdrop-blur-md"
        :class="stats.fps >= 50 ? 'text-lime-300' : stats.fps >= 30 ? 'text-amber-300' : 'text-rose-300'"
      >
        ⚡ {{ stats.fps }}
      </span>
      <!-- 背景音樂下拉 -->
      <select
        v-model.number="music"
        @change="onMusic"
        class="h-11 rounded-full bg-black/40 px-3 text-sm font-bold text-white backdrop-blur-md outline-none"
      >
        <option :value="0">🎵 關閉</option>
        <option v-for="(name, i) in musicTracks" :key="i" :value="i + 1">🎵 {{ name }}</option>
      </select>
    </div>

    <!-- Debug 面板：背後金條參數 -->
    <div
      v-if="showDebug"
      class="absolute left-3 top-16 z-40 w-64 rounded-2xl bg-black/80 p-3 text-xs text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
    >
      <div class="mb-2 text-sm font-black text-fuchsia-300">🪙 背後金條 Debug</div>
      <div class="mb-3">
        <div class="flex justify-between"><span>金條層距（疊高間距）</span><span class="font-bold">{{ goldLayerH.toFixed(2) }}</span></div>
        <input type="range" class="w-full accent-fuchsia-400" min="0.1" max="0.8" step="0.01" v-model.number="goldLayerH" @input="onGoldLayerH" />
      </div>
      <div class="mb-3">
        <div class="flex justify-between"><span>離肉的距離（往後）</span><span class="font-bold">{{ goldBackOffset.toFixed(2) }}</span></div>
        <input type="range" class="w-full accent-fuchsia-400" min="0.8" max="5" step="0.01" v-model.number="goldBackOffset" @input="onGoldBackOffset" />
      </div>

      <div class="mb-2 text-sm font-black text-fuchsia-300">🎥 鏡頭 Debug</div>
      <div class="mb-3">
        <div class="flex justify-between"><span>遠近（縮放）</span><span class="font-bold">{{ camRadius.toFixed(0) }}</span></div>
        <input type="range" class="w-full accent-fuchsia-400" min="14" max="70" step="0.5" v-model.number="camRadius" @input="onCamRadius" />
      </div>
      <div class="mb-3">
        <div class="flex justify-between"><span>旋轉角度（度）</span><span class="font-bold">{{ camAngle.toFixed(0) }}°</span></div>
        <input type="range" class="w-full accent-fuchsia-400" min="-180" max="180" step="1" v-model.number="camAngle" @input="onCamAngle" />
      </div>

      <div class="mb-2 text-sm font-black text-fuchsia-300">🌲 地圖裝飾 Debug</div>
      <div class="mb-3">
        <div class="flex justify-between"><span>樹木數量</span><span class="font-bold">{{ treeCount }}</span></div>
        <input type="range" class="w-full accent-fuchsia-400" min="0" max="2000" step="1" v-model.number="treeCount" @input="onTreeCount" />
      </div>

      <div class="mb-2 text-sm font-black text-fuchsia-300">💰 金錢 Debug</div>
      <div>
        <div class="flex justify-between"><span>設定金錢</span><span class="font-bold">{{ moneyDebug.toLocaleString() }}</span></div>
        <input type="range" class="w-full accent-fuchsia-400" min="0" max="5000" step="50" v-model.number="moneyDebug" @input="onMoney" />
      </div>
    </div>

    <!-- 操作提示 -->
    <div
      v-if="showHint"
      class="pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-xl bg-black/55 px-4 py-2 text-center text-xs text-white/90 backdrop-blur-md sm:text-sm"
    >
      基地內踩 🪓🗡️🔫 換武器 → 進 🐄牧場 打牛 → 撿肉走回 🥩販售 擺攤 → 顧客買單後到 💲收銀 收錢 → 踩升級墊變強
    </div>

    <!-- 點塔升級選單 -->
    <div
      v-if="stats.selectedTower"
      class="absolute bottom-28 left-1/2 z-30 w-64 -translate-x-1/2 rounded-2xl bg-black/80 p-3 text-center text-white shadow-2xl ring-1 ring-white/15 backdrop-blur-md"
    >
      <button
        class="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-sm hover:bg-white/30"
        @click="onTowerClose"
      >
        ✕
      </button>
      <div class="text-lg font-black">
        {{ stats.selectedTower.type === 'cannon' ? '💣 砲塔' : '🏹 機槍塔' }}
        <span class="ml-1 text-sky-300">Lv.{{ stats.selectedTower.level }}/{{ stats.selectedTower.maxLevel }}</span>
      </div>
      <div class="mt-1 text-xs text-white/70">傷害 / 射速 隨等級提升</div>
      <button
        v-if="!stats.selectedTower.maxed"
        class="mt-2.5 w-full rounded-xl px-4 py-2.5 text-base font-black transition active:scale-95"
        :class="stats.selectedTower.affordable ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-white/15 text-white/50'"
        @click="onTowerUpgrade"
      >
        ⬆️ 升級　💰 {{ stats.selectedTower.cost.toLocaleString() }}
      </button>
      <div v-else class="mt-2.5 rounded-xl bg-amber-500/30 px-4 py-2.5 text-base font-black text-amber-200">已滿級 ✦</div>
    </div>

    <joystick class="absolute bottom-8 left-8 z-10" @move="onJoyMove" @end="onJoyEnd" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { createGame, type GameHandle, type GameStats } from '../game/game';
import { sound } from '../game/sound';
import Hud from './hud.vue';
import Joystick from './joystick.vue';

const canvasRef = ref<HTMLCanvasElement>();
const stats = reactive<GameStats>({
  fps: 0,
  money: 0,
  hp: 100,
  maxHp: 100,
  damageFlash: 0,
  carried: 0,
  carryCap: 0,
  counterMeat: 0,
  counterCap: 0,
  cashPending: 0,
  customers: 0,
  weaponEmoji: '🗡️',
  weaponName: '大砍刀',
  nearUpgrade: null,
  defenseActive: false,
  houseHp: 0,
  houseMaxHp: 0,
  waveLabel: '',
  selectedTower: null,
});

let game: GameHandle | undefined;

const MUTE_KEY = 'fake-whiteout:muted';
const muted = ref(localStorage.getItem(MUTE_KEY) === '1');

/** 背景音樂：0＝關閉，1~5＝對應曲目（下拉選） */
const MUSIC_KEY = 'fake-whiteout:music';
const musicTracks = sound.musicTracks();
const music = ref(Number(localStorage.getItem(MUSIC_KEY) ?? '0'));
function onMusic() {
  sound.enable();
  sound.setMusic(music.value - 1); // 0=關 → -1
  localStorage.setItem(MUSIC_KEY, String(music.value));
}

const showHint = ref(true);
let hintTimer: number | undefined;
/** 避開瀏海/動態島 */
const safeTop = { top: 'max(0.75rem, env(safe-area-inset-top))' };

/** Debug：背後金條參數（與 game.ts 預設一致） */
const showDebug = ref(false);
const goldLayerH = ref(0.48);
const goldBackOffset = ref(2.48);
function onGoldLayerH() {
  game?.setGoldLayerH(goldLayerH.value);
}
function onGoldBackOffset() {
  game?.setGoldBackOffset(goldBackOffset.value);
}
/** 鏡頭：遠近（半徑）與旋轉角度（度），預設與 config 一致（radius 34、alpha -90°） */
const camRadius = ref(34);
const camAngle = ref(-90);
function onCamRadius() {
  game?.setCameraRadius(camRadius.value);
}
function onCamAngle() {
  game?.setCameraAlpha((camAngle.value * Math.PI) / 180);
}
/** 地圖樹木數量（預設與 game.ts treeVisible 一致） */
const treeCount = ref(2000);
function onTreeCount() {
  game?.setTreeCount(treeCount.value);
}
/** Debug：直接設定金錢（拉桿值＝設定目標，非即時金錢） */
const moneyDebug = ref(0);
function onMoney() {
  game?.setMoney(moneyDebug.value);
}

onMounted(() => {
  if (!canvasRef.value) return;
  game = createGame(canvasRef.value, {
    onStats: (s) => Object.assign(stats, s),
  });
  game.setMuted(muted.value);
  /** 套用上次選的背景音樂（實際播放會等首次點擊/移動解鎖音訊） */
  if (music.value > 0) sound.setMusic(music.value - 1);
  hintTimer = window.setTimeout(() => (showHint.value = false), 9000);
});

onBeforeUnmount(() => {
  if (hintTimer !== undefined) clearTimeout(hintTimer);
  game?.dispose();
});

function onJoyMove(dir: { x: number; z: number }) {
  game?.setJoystick(dir.x, dir.z);
}
function onJoyEnd() {
  game?.setJoystick(0, 0);
}
function onTowerUpgrade() {
  game?.upgradeSelectedTower();
}
function onTowerClose() {
  game?.deselectTower();
}
function onToggleMute() {
  muted.value = !muted.value;
  localStorage.setItem(MUTE_KEY, muted.value ? '1' : '0');
  game?.setMuted(muted.value);
}
</script>
