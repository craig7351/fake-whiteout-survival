<template>
  <!-- 左下角觸控區：在此範圍內按下都操作搖桿（吸收觸控，不會傳到 canvas 轉鏡頭） -->
  <div
    ref="zoneRef"
    class="zone touch-none"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <!-- 未操作：靜態提示底盤 -->
    <div v-if="!dragging" class="pad pad-rest">
      <div class="thumb" />
    </div>
    <!-- 操作中：浮動底盤跟著手指出現 -->
    <div v-else class="pad pad-active" :style="padStyle">
      <div class="thumb" :style="thumbStyle" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const emit = defineEmits<{
  (e: 'move', dir: { x: number; z: number }): void;
  (e: 'end'): void;
}>();

const zoneRef = ref<HTMLElement>();
const dragging = ref(false);
const RADIUS = 64; // 搖桿半徑（px）
const origin = ref({ x: 0, y: 0 }); // 按下時的中心（相對 zone 左上）
const offset = ref({ x: 0, y: 0 }); // thumb 位移

/** 浮動底盤的位置（中心對齊按下點） */
const padStyle = computed(() => ({ left: `${origin.value.x}px`, top: `${origin.value.y}px` }));
const thumbStyle = computed(() => ({ transform: `translate(${offset.value.x}px, ${offset.value.y}px)` }));

function update(clientX: number, clientY: number) {
  let dx = clientX - originClient.x;
  let dy = clientY - originClient.y;
  const len = Math.hypot(dx, dy);
  if (len > RADIUS) {
    dx = (dx / len) * RADIUS;
    dy = (dy / len) * RADIUS;
  }
  offset.value = { x: dx, y: dy };
  /** 螢幕向上 = 世界 +z；螢幕向右 = 世界 +x */
  emit('move', { x: dx / RADIUS, z: -dy / RADIUS });
}

/** 按下點的螢幕座標（算位移用） */
const originClient = { x: 0, y: 0 };
function onDown(e: PointerEvent) {
  const rect = zoneRef.value?.getBoundingClientRect();
  if (!rect) return;
  dragging.value = true;
  originClient.x = e.clientX;
  originClient.y = e.clientY;
  origin.value = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  offset.value = { x: 0, y: 0 };
  zoneRef.value?.setPointerCapture(e.pointerId);
}
function onMove(e: PointerEvent) {
  if (!dragging.value) return;
  update(e.clientX, e.clientY);
}
function onUp() {
  if (!dragging.value) return;
  dragging.value = false;
  offset.value = { x: 0, y: 0 };
  emit('end');
}
</script>

<style scoped>
/** 觸控區：覆蓋左下角，吸收此區觸控避免轉動鏡頭 */
.zone {
  position: absolute;
  left: 0;
  bottom: 0;
  width: min(52vw, 26rem);
  height: min(46vh, 24rem);
  z-index: 20;
}
.pad {
  position: absolute;
  width: 9rem;
  height: 9rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
}
/** 靜態提示底盤：固定在左下、半透明 */
.pad-rest {
  left: 2rem;
  bottom: 2rem;
  opacity: 0.55;
}
/** 浮動底盤：中心對齊按下點 */
.pad-active {
  transform: translate(-50%, -50%);
}
.thumb {
  width: 42%;
  height: 42%;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.55);
}
</style>
