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
