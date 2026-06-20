import { createApp } from 'vue';
import { DracoCompression } from '@babylonjs/core';
import App from './App.vue';
import './style.css';

/**
 * 模型皆以 Draco 壓縮，解碼器改用自帶檔（public/draco/，同源），不依賴外部 CDN。
 * 於進入點設定，確保所有載入路徑皆生效。
 */
DracoCompression.Configuration = {
  decoder: {
    wasmUrl: '/draco/draco_wasm_wrapper_gltf.js',
    wasmBinaryUrl: '/draco/draco_decoder_gltf.wasm',
    fallbackUrl: '/draco/draco_decoder_gltf.js',
  },
};

createApp(App).mount('#app');

/**
 * 關閉 iOS Safari 的「雙擊放大」：touch-action 在 iOS 不一定生效，
 * 改攔截 300ms 內的第二次 touchend（排除按鈕/輸入框/下拉，避免影響 UI 操作）。
 */
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.closest('button, input, select, textarea, a')) return; // UI 控制項照常
    const now = e.timeStamp;
    if (now - lastTouchEnd <= 500) e.preventDefault(); // 窗口加大到 500ms，攔住較慢的雙擊
    lastTouchEnd = now;
  },
  { passive: false },
);
/** 雙擊（dblclick）也擋掉，雙保險 */
document.addEventListener('dblclick', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && t.closest('button, input, select, textarea, a')) return;
  e.preventDefault();
});
/** 同時擋掉手勢縮放（雙指）的 gesturestart（iOS 專有） */
document.addEventListener('gesturestart', (e) => e.preventDefault());

/**
 * 偵測頁面是否被放大（visualViewport.scale > 1），若是就自動夾回 1。
 * 處理「雙擊偶爾仍放大且回不去」：把 viewport 的 maximum-scale 先設 <1 再設回 1，
 * 強迫 Safari 重新把目前縮放夾回 1。
 */
const viewportMeta = document.querySelector('meta[name="viewport"]');
const VIEWPORT_BASE = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
function resetPageZoom() {
  if (!viewportMeta) return;
  viewportMeta.setAttribute('content', VIEWPORT_BASE.replace('maximum-scale=1.0', 'maximum-scale=0.99'));
  viewportMeta.setAttribute('content', VIEWPORT_BASE);
}
const vv = window.visualViewport;
if (vv) {
  vv.addEventListener('resize', () => {
    if (vv.scale > 1.01) resetPageZoom();
  });
}
