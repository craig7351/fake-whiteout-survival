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
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);
/** 同時擋掉手勢縮放（雙指）外的 gesturestart（iOS 專有） */
document.addEventListener('gesturestart', (e) => e.preventDefault());
