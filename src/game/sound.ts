/**
 * 極簡音效：純 WebAudio 合成，不依賴外部音檔。
 * 提供拿肉、擺肉、收錢、升級等短音效，與輕量背景環境音。
 */
let ctx: AudioContext | null = null;
let muted = false;
let master: GainNode | null = null;

function ensure(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.4;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 一個簡單的「啵」音：指定頻率、時長、波形、音量 */
function blip(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.5, slideTo?: number) {
  const c = ensure();
  if (!c || !master) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(vol, c.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  osc.connect(g);
  g.connect(master);
  osc.start();
  osc.stop(c.currentTime + dur + 0.02);
}

export const sound = {
  setMuted(v: boolean) {
    muted = v;
    if (master) master.gain.value = v ? 0 : 0.4;
  },
  /** 使用者首次互動時呼叫，喚醒 AudioContext */
  enable() {
    ensure();
  },
  /** 拿起一塊肉：輕快短音 */
  pickup() {
    blip(520, 0.08, 'triangle', 0.35, 620);
  },
  /** 擺一塊肉到攤位：悶一點 */
  place() {
    blip(300, 0.09, 'sine', 0.3, 240);
  },
  /** 顧客成交、付錢：清脆金幣聲 */
  sell() {
    blip(880, 0.07, 'square', 0.18, 1320);
  },
  /** 收一筆錢進錢包 */
  cash() {
    blip(740, 0.06, 'triangle', 0.3, 1100);
    blip(1180, 0.08, 'sine', 0.2, 1480);
  },
  /** 揮刀打到牛：短促打擊聲 */
  hit() {
    blip(220, 0.06, 'square', 0.16, 150);
  },
  /** 牛被擊殺：低沉爆裂 */
  kill() {
    blip(160, 0.16, 'sawtooth', 0.28, 90);
    blip(420, 0.1, 'triangle', 0.18, 260);
  },
  /** 近戰揮砍：破風聲 */
  swing() {
    blip(640, 0.08, 'triangle', 0.12, 240);
  },
  /** 衝鋒槍射擊：短促槍聲 */
  shoot() {
    blip(900, 0.04, 'square', 0.14, 280);
    blip(180, 0.05, 'sawtooth', 0.12, 90);
  },
  /** 升級成功：上揚和弦 */
  upgrade() {
    blip(523, 0.12, 'triangle', 0.4, 784);
    setTimeout(() => blip(784, 0.16, 'triangle', 0.4, 1046), 90);
  },
  /** 升不起（錢不夠）：低悶提示 */
  denied() {
    blip(180, 0.12, 'sawtooth', 0.18, 120);
  },
  /** 爆炸：低頻轟然 + 碎裂噪聲（炸開牧場2） */
  boom() {
    blip(90, 0.5, 'sawtooth', 0.5, 38);
    blip(150, 0.35, 'square', 0.32, 60);
    setTimeout(() => blip(70, 0.45, 'sawtooth', 0.35, 28), 70);
  },
};
