<template>
  <!-- 右上：金錢大膠囊（手機主視覺，參考熱門遊戲） -->
  <div
    class="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full bg-slate-900/60 px-4 py-2 shadow-lg shadow-cyan-500/10 ring-2 ring-cyan-300/30 backdrop-blur-md"
    :style="safeTop"
  >
    <span class="text-2xl sm:text-3xl">💰</span>
    <span class="min-w-[2ch] text-center text-3xl font-black tabular-nums text-amber-100 sm:text-4xl">
      {{ stats.money.toLocaleString() }}
    </span>
  </div>

  <!-- 左上：血條 + 狀態 chips（在控制鈕下方） -->
  <div class="absolute left-3 top-[4.5rem] z-10 flex flex-col items-start gap-2">
    <!-- 生命條 -->
    <div class="flex items-center gap-2">
      <span class="text-xl">❤️</span>
      <div class="h-4 w-40 overflow-hidden rounded-full bg-slate-900/55 ring-1 ring-cyan-200/15 sm:w-48">
        <div
          class="h-full rounded-full transition-[width] duration-150"
          :class="hpRatio > 0.5 ? 'bg-emerald-400' : hpRatio > 0.25 ? 'bg-amber-400' : 'bg-rose-500'"
          :style="{ width: `${hpRatio * 100}%` }"
        />
      </div>
    </div>
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
      <span class="text-lg">🏠</span>
      <div class="h-3.5 w-44 overflow-hidden rounded-full bg-slate-900/55 ring-1 ring-cyan-200/15 sm:w-56">
        <div
          class="h-full rounded-full transition-[width] duration-150"
          :class="houseRatio > 0.5 ? 'bg-emerald-400' : houseRatio > 0.25 ? 'bg-amber-400' : 'bg-rose-500'"
          :style="{ width: `${houseRatio * 100}%` }"
        />
      </div>
    </div>
  </div>

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
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { GameStats } from '../game/game';

const props = defineProps<{ stats: GameStats }>();
const hpRatio = computed(() => (props.stats.maxHp > 0 ? Math.max(0, Math.min(1, props.stats.hp / props.stats.maxHp)) : 0));
const houseRatio = computed(() => (props.stats.houseMaxHp > 0 ? Math.max(0, Math.min(1, props.stats.houseHp / props.stats.houseMaxHp)) : 0));
/** 避開瀏海/動態島 */
const safeTop = { top: 'max(0.75rem, env(safe-area-inset-top))' };
</script>
