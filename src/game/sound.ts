/**
 * 極簡音效：純 WebAudio 合成，不依賴外部音檔。
 * 提供拿肉、擺肉、收錢、升級等短音效，與輕量背景環境音。
 */
let ctx: AudioContext | null = null;
let muted = false;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;

/** 建立/取得 AudioContext（不理會靜音；靜音時 master 增益為 0，仍可排程背景音樂） */
function ensureCtx(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.4;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16; // 背景音樂音量（比音效低）
      musicGain.connect(master);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 音效用：靜音時直接跳過 */
function ensure(): AudioContext | null {
  if (muted) return null;
  return ensureCtx();
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

/** 一段濾波白噪聲：用於打擊/揮砍的「實體感」（劈、噗、咻） */
function noise(dur: number, vol: number, type: BiquadFilterType = 'lowpass', freq = 900) {
  const c = ensure();
  if (!c || !master) return;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start();
  src.stop(c.currentTime + dur + 0.02);
}

/* ===== 背景音樂：5 種程序合成循環曲（自帶不需音檔） ===== */
interface MusicTrack {
  name: string;
  bpm: number;
  bass: OscillatorType;
  lead: OscillatorType;
  base: number; // 根音 MIDI
  chords: number[][]; // 每小節和弦（相對 base 的半音）
}
/** 順序＝下拉選單由上到下；和弦以三/四音表示，引擎做琶音 */
const MUSIC_TRACKS: MusicTrack[] = [
  { name: '輕快', bpm: 120, bass: 'triangle', lead: 'triangle', base: 57, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]] },
  { name: '悠閒', bpm: 80, bass: 'sine', lead: 'sine', base: 60, chords: [[0, 4, 7, 11], [5, 9, 12], [-3, 0, 4], [-5, 0, 3, 7]] },
  { name: '歡樂', bpm: 138, bass: 'square', lead: 'square', base: 60, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]] },
  { name: '緊張', bpm: 150, bass: 'sawtooth', lead: 'sawtooth', base: 50, chords: [[0, 3, 7], [-2, 1, 5], [-4, 0, 3], [0, 3, 7]] },
  { name: '神秘', bpm: 72, bass: 'triangle', lead: 'sine', base: 55, chords: [[0, 3, 7, 10], [5, 8, 12], [3, 7, 10], [-2, 2, 5]] },
];

let musicTimer: number | null = null;
let musicTrack = -1; // -1 = 關閉
let musicStep = 0;
let musicNextTime = 0;

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 排程單一音樂音符（經 musicGain，受 master 靜音控制） */
function musicNote(freq: number, time: number, dur: number, wave: OscillatorType, vol: number) {
  if (!ctx || !musicGain) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(vol, time + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  osc.connect(g);
  g.connect(musicGain);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

/** lookahead 排程器：每 ~25ms 把未來 0.15s 內的音符排進去 */
function musicScheduler() {
  const c = ensureCtx();
  if (!c || musicTrack < 0) return;
  const t = MUSIC_TRACKS[musicTrack];
  const stepDur = 60 / t.bpm / 2; // 8 分音符
  if (musicNextTime < c.currentTime) musicNextTime = c.currentTime + 0.05; // 靜音/分頁切回後追上
  while (musicNextTime < c.currentTime + 0.15) {
    const chord = t.chords[Math.floor(musicStep / 8) % t.chords.length];
    const beat = musicStep % 8;
    /** 低音：每半小節一個長音（根音低八度） */
    if (beat === 0 || beat === 4) musicNote(midiToFreq(t.base + chord[0] - 12), musicNextTime, stepDur * 1.8, t.bass, 0.5);
    /** 主旋律：和弦音琶音（高八度），輕快短音 */
    const lead = chord[beat % chord.length] + 12;
    musicNote(midiToFreq(t.base + lead), musicNextTime, stepDur * 0.9, t.lead, 0.32);
    musicNextTime += stepDur;
    musicStep++;
  }
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
  /** 背景音樂曲目名稱（供下拉選單顯示） */
  musicTracks(): string[] {
    return MUSIC_TRACKS.map((t) => t.name);
  },
  /** 選背景音樂：-1＝關閉，0~4＝對應曲目 */
  setMusic(index: number) {
    musicTrack = index >= 0 && index < MUSIC_TRACKS.length ? index : -1;
    if (musicTrack < 0) {
      if (musicTimer !== null) {
        clearInterval(musicTimer);
        musicTimer = null;
      }
      return;
    }
    ensureCtx();
    musicStep = 0;
    musicNextTime = 0;
    if (musicTimer === null) musicTimer = window.setInterval(musicScheduler, 25);
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
  /** 揮刀打到牛：短促打擊聲 + 肉感悶噗 */
  hit() {
    blip(220, 0.06, 'square', 0.16, 150);
    noise(0.07, 0.22, 'lowpass', 1300);
  },
  /** 牛被擊殺：低沉爆裂 + 噴濺噗聲 */
  kill() {
    blip(160, 0.16, 'sawtooth', 0.3, 90);
    blip(420, 0.1, 'triangle', 0.18, 260);
    noise(0.22, 0.32, 'lowpass', 650);
  },
  /** 近戰揮砍：破風聲 + 咻 */
  swing() {
    blip(640, 0.08, 'triangle', 0.12, 240);
    noise(0.12, 0.12, 'highpass', 1700);
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
  /** 冰霜爆裂：清脆高音 + 高頻碎裂噪聲（緩速炸彈命中） */
  frost() {
    blip(1320, 0.12, 'triangle', 0.18, 660);
    noise(0.18, 0.16, 'highpass', 4200);
    setTimeout(() => blip(1760, 0.1, 'sine', 0.12, 990), 60);
  },
};
