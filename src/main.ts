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
 * 只擋「雙指縮放頁面」(gesturestart)，避免和 Babylon 的鏡頭縮放打架；
 * 不再攔截「雙擊」—— 保留 iOS 原生雙擊行為，讓「雙擊空白處」能把畫面還原成 100%。
 */
document.addEventListener('gesturestart', (e) => e.preventDefault());

/**
 * 防止雙擊放大：攔在「touchstart」（iOS 上常比 touchend 有效）。
 * 第二次快速點擊（<350ms、單指）就 preventDefault，阻止瀏覽器啟動雙擊縮放。
 * 排除按鈕/輸入框/連結/可捲動區，避免影響正常操作與留言板捲動。
 */
let lastTouchStart = 0;
document.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length > 1) return;
    const t = e.target as HTMLElement | null;
    if (t && t.closest('button, input, select, textarea, a, .overflow-y-auto')) return;
    const now = e.timeStamp;
    if (now - lastTouchStart < 350) e.preventDefault(); // 擋第二快點 → 阻止雙擊放大
    lastTouchStart = now;
  },
  { passive: false },
);
