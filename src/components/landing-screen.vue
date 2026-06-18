<template>
  <div class="relative flex h-full w-full flex-col items-center justify-center overflow-hidden">
    <!-- 雪地漸層背景 -->
    <div class="absolute inset-0 bg-gradient-to-b from-[#9fb8d8] to-[#e9eef6]" />

    <!-- 飄雪 -->
    <div class="pointer-events-none absolute inset-0">
      <span
        v-for="(f, i) in flakes"
        :key="i"
        class="absolute rounded-full bg-white/80"
        :style="f"
      />
    </div>

    <div class="relative z-10 flex flex-col items-center px-6 text-center">
      <div class="mb-2 text-6xl">🥩❄️</div>
      <h1 class="mb-1 text-4xl font-black text-slate-800 drop-shadow sm:text-5xl">雪地肉舖</h1>
      <p class="mb-1 text-sm font-bold tracking-widest text-slate-600">FAKE WHITEOUT SURVIVAL</p>
      <p class="mb-8 max-w-xs text-xs text-slate-500 sm:text-sm">
        在暴風雪中經營你的肉舖：加工、擺攤、賣肉、收錢、升級擴張。
      </p>

      <button
        class="rounded-2xl bg-emerald-500 px-12 py-4 text-2xl font-black text-white shadow-xl ring-2 ring-emerald-300/50 transition hover:bg-emerald-400 active:scale-95"
        @click="emit('start')"
      >
        立即遊玩
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{ (e: 'start'): void }>();

/** 隨機飄雪樣式 */
const flakes = Array.from({ length: 40 }, () => {
  const size = 3 + Math.random() * 6;
  return {
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    width: `${size}px`,
    height: `${size}px`,
    opacity: `${0.3 + Math.random() * 0.6}`,
  } as Record<string, string>;
});
</script>
