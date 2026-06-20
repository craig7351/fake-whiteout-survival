<template>
  <!-- 右上：金錢大膠囊（手機主視覺，參考熱門遊戲） -->
  <div
    class="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-slate-900/60 px-3 py-1.5 shadow-lg shadow-cyan-500/10 ring-2 ring-cyan-300/30 backdrop-blur-md sm:gap-2 sm:px-4 sm:py-2"
    :style="safeTop"
  >
    <span class="text-lg sm:text-3xl">💰</span>
    <span class="min-w-[2ch] text-center text-xl font-black tabular-nums text-amber-100 sm:text-4xl">
      {{ stats.money.toLocaleString() }}
    </span>
  </div>

  <!-- 左上：狀態 chips（血量改顯示在玩家頭頂） -->
  <div class="absolute left-3 top-[4.5rem] z-10 flex flex-col items-start gap-2">
    <!-- 狀態 chips -->
    <div class="flex flex-wrap gap-2 text-sm sm:text-base">
      <span class="rounded-xl bg-slate-900/55 px-3 py-1.5 font-black text-rose-200 backdrop-blur-md ring-1 ring-cyan-200/15">
        🎒 {{ stats.carried }}
      </span>
      <span class="rounded-xl bg-slate-900/55 px-3 py-1.5 font-black text-amber-200 backdrop-blur-md ring-1 ring-cyan-200/15">
        🥩 {{ stats.counterMeat }}
      </span>
      <span class="rounded-xl bg-slate-900/55 px-3 py-1.5 font-black text-sky-200 backdrop-blur-md ring-1 ring-cyan-200/15">
        {{ stats.weaponEmoji }} {{ stats.weaponName }}
      </span>
      <span
        v-if="stats.cashPending > 0"
        class="rounded-xl bg-emerald-600/70 px-3 py-1.5 font-black text-white backdrop-blur-md ring-1 ring-white/20"
      >
        💵 {{ stats.cashPending }}
      </span>
    </div>
  </div>

  <!-- 房子防禦戰：上方波次提示 + 房子血條 -->
  <div
    v-if="stats.defenseActive"
    class="absolute left-1/2 top-20 z-20 flex -translate-x-1/2 flex-col items-center gap-1"
  >
    <div class="rounded-xl bg-slate-950/65 px-4 py-1.5 text-center text-sm font-black text-cyan-50 backdrop-blur-md ring-1 ring-cyan-200/20 sm:text-base">
      {{ stats.waveLabel }}
    </div>
    <div class="flex items-center gap-2">
      <span class="text-lg">🛡️</span>
      <div class="h-3.5 w-44 overflow-hidden rounded-full bg-slate-900/55 ring-1 ring-cyan-200/15 sm:w-56">
        <div
          class="h-full rounded-full transition-[width] duration-150"
          :class="breachRatio < 0.5 ? 'bg-emerald-400' : breachRatio < 0.8 ? 'bg-amber-400' : 'bg-rose-500'"
          :style="{ width: `${breachRatio * 100}%` }"
        />
      </div>
      <span class="text-xs font-black text-rose-200">{{ stats.breaches }}/{{ stats.breachMax }}</span>
    </div>
  </div>

  <!-- 防線告急：攻入達 8/10 起，畫面邊緣脈動泛紅警告 -->
  <div v-if="stats.defenseActive && breachRatio >= 0.8" class="breach-warn pointer-events-none absolute inset-0 z-30" />

  <!-- 受擊紅光暈（被牛攻擊時畫面邊緣泛紅） -->
  <div
    class="pointer-events-none absolute inset-0 z-30"
    :style="{
      opacity: stats.damageFlash,
      background: 'radial-gradient(ellipse at center, transparent 42%, rgba(225,25,25,0.9) 100%)',
      transition: 'opacity 70ms linear',
    }"
  />

  <!-- 升級提示（站上升級地墊時，加大字級給手機看） -->
  <div
    v-if="stats.nearUpgrade"
    class="pointer-events-none absolute bottom-32 left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-slate-950/80 px-6 py-3.5 text-center text-white shadow-2xl ring-1 ring-cyan-200/20 backdrop-blur-md"
  >
    <div class="text-lg font-black sm:text-xl">
      {{ stats.nearUpgrade.emoji }} {{ stats.nearUpgrade.name }}
      <span class="ml-1 text-base text-cyan-300">Lv.{{ stats.nearUpgrade.level }}/{{ stats.nearUpgrade.maxLevel }}</span>
    </div>
    <div v-if="stats.nearUpgrade.maxed" class="mt-1 text-base font-black text-amber-300">已滿級 ✦</div>
    <div
      v-else
      class="mt-1 text-base font-bold"
      :class="stats.nearUpgrade.affordable ? 'text-emerald-300' : 'text-rose-300'"
    >
      站著不動升級　💰 {{ stats.nearUpgrade.cost }}
      <span v-if="!stats.nearUpgrade.affordable">（錢不夠）</span>
    </div>
  </div>

  <!-- 靠近功能框：說明卡（解決看不懂地上圖案） -->
  <div
    v-if="stats.nearInfo && !stats.nearUpgrade && !stats.selectedTower"
    class="pointer-events-none absolute bottom-32 left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-slate-950/80 px-6 py-3 text-center text-white shadow-2xl ring-1 ring-cyan-200/20 backdrop-blur-md"
  >
    <div class="text-lg font-black sm:text-xl">{{ stats.nearInfo.emoji }} {{ stats.nearInfo.name }}</div>
    <div class="mt-0.5 text-sm text-cyan-200">{{ stats.nearInfo.effect }}</div>
    <div class="mt-1 text-xs text-slate-300">{{ stats.nearInfo.hint }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { GameStats } from '../game/game';

const props = defineProps<{ stats: GameStats }>();
const breachRatio = computed(() => (props.stats.breachMax > 0 ? Math.max(0, Math.min(1, props.stats.breaches / props.stats.breachMax)) : 0));
/** 避開瀏海/動態島 */
const safeTop = { top: 'max(0.75rem, env(safe-area-inset-top))' };
</script>

<style scoped>
.breach-warn {
  background: radial-gradient(ellipse at center, transparent 45%, rgba(225, 25, 25, 0.85) 100%);
  animation: breachpulse 0.85s ease-in-out infinite;
}
@keyframes breachpulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 0.9;
  }
}
</style>
