/* ==========================================================================
   并购风云 · 音效
   全部用 Web Audio 实时合成，不依赖任何音频文件（file:// 下也能用）。

   音色取向：明亮、干净、尾音迅速衰减。

   ── 可调校 ───────────────────────────────────────────────────────────
   每种声音都有独立的调校参数（音高 / 余响 / 混响 / 音量），
   由「sfx-tuner.html」写入 localStorage，游戏启动时自动读取。
   调校只改参数，音色本体（波形与结构）保持不变。
   ========================================================================== */

(function (root) {
  'use strict';

  const TUNE_KEY = 'acquire.sfxTune.v1';

  /* ------------------------------------------------------------ 调校默认值 */

  const SOUND_NAMES = [
    'ui', 'hover', 'select', 'place', 'draw', 'cash',
    'found', 'merge', 'error', 'win', 'tick', 'turn',
  ];

  function defaultTune() {
    const o = {};
    SOUND_NAMES.forEach(function (k) {
      o[k] = { pitch: 1, decay: 1, reverb: 0, volume: 1 };
    });
    return o;
  }

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  /** 合并一份外部配置（缺项用默认值补齐，超出范围的钳制回去） */
  function mergeTune(patch) {
    const out = defaultTune();
    if (patch && typeof patch === 'object') {
      SOUND_NAMES.forEach(function (k) {
        const src = patch[k];
        if (!src) return;
        out[k] = {
          pitch: clamp(num(src.pitch, 1), 0.4, 2.5),
          decay: clamp(num(src.decay, 1), 0.2, 3),
          reverb: clamp(num(src.reverb, 0), 0, 1),
          volume: clamp(num(src.volume, 1), 0, 2),
        };
      });
    }
    return out;
  }

  let tuning = defaultTune();

  /* --------------------------------------------------------------- 音频域 */

  let ctx = null;
  let enabled = true;
  let master = null;
  let reverbNode = null;
  let volume = 1;            // 来自设置滑块（0~1）
  let active = null;         // 正在播放的这条声音的调校

  function audio() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try { ctx = new Ctor(); } catch (e) { return null; }

      master = ctx.createGain();
      master.gain.value = 2.0 * volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  /** 生成一段混响脉冲（噪声指数衰减），比外部音频文件更适合 file:// */
  function reverbBus(c) {
    if (reverbNode) return reverbNode;

    const dur = 2.4;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(2, len, c.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
      }
    }

    const conv = c.createConvolver();
    conv.buffer = buf;

    const wet = c.createGain();
    wet.gain.value = 1;
    conv.connect(wet);
    wet.connect(master);

    reverbNode = conv;
    return conv;
  }

  /** 把一条已生成的信号送一份到混响 */
  function sendReverb(c, node, wet) {
    if (!(wet > 0)) return;
    try {
      const send = c.createGain();
      send.gain.value = wet * 0.9;
      node.connect(send);
      send.connect(reverbBus(c));
    } catch (e) { /* 混响不可用就静音跳过 */ }
  }

  /**
   * 一个音。
   * f = 起始频率，d = 时长（秒），g = 音量，t = 延迟，type = 波形，to = 滑到的频率
   * 会按当前声音的调校参数缩放。
   */
  function tone(f, d, g, t, type, to) {
    const c = audio();
    if (!c) return;

    const T = active || {};
    const pitch = T.pitch || 1;
    const decay = T.decay || 1;
    const vol = (T.volume == null ? 1 : T.volume);

    const start = c.currentTime + (t || 0);
    const dur = (d || 0.06) * decay;

    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(f * pitch, start);
    if (to) osc.frequency.exponentialRampToValueAtTime(to * pitch, start + dur);

    // 极短的起音 + 指数衰减，听起来才有「叮」的干净感
    const peak = Math.max((g || 0.05) * vol, 0.0002);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(gain);
    gain.connect(master);
    sendReverb(c, gain, T.reverb || 0);

    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** 极短的噪声，用来做「落子」的实感 */
  function tick(g, dur) {
    const c = audio();
    if (!c) return;

    const T = active || {};
    const decay = T.decay || 1;
    const d = (dur || 0.05) * decay;
    const frames = Math.max(1, Math.floor(c.sampleRate * d));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 6);
    }

    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();

    filter.type = 'bandpass';
    filter.frequency.value = 2200 * (T.pitch || 1);
    filter.Q.value = 1.2;

    gain.gain.value = (g || 0.05) * (T.volume == null ? 1 : T.volume);

    src.buffer = buffer;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    sendReverb(c, gain, T.reverb || 0);
    src.start();
  }

  /* ------------------------------------------------------------ 音色本体 */

  const SOUNDS = {
    /* 通用按钮 */
    ui() {
      tone(1244, 0.045, 0.055);
    },

    /* 悬停 */
    hover() {
      tone(1568, 0.03, 0.022);
    },

    /* 选中手牌 */
    select() {
      tone(1760, 0.055, 0.05);
    },

    /* 落子：清脆的「垛」 */
    place() {
      tick(0.08);
      tone(880, 0.07, 0.06);
      tone(1318, 0.05, 0.035, 0.012);
    },

    /* 抽牌 */
    draw() {
      tone(1046, 0.04, 0.048);
      tone(1568, 0.06, 0.038, 0.035);
    },

    /* 收钱 */
    cash() {
      tone(1318, 0.05, 0.052);
      tone(1760, 0.08, 0.045, 0.045);
    },

    /* 创立公司 */
    found() {
      tone(1046, 0.07, 0.052);
      tone(1318, 0.07, 0.045, 0.06);
      tone(1760, 0.1, 0.04, 0.12);
    },

    /* 并购开始 */
    merge() {
      tone(659, 0.1, 0.055);
      tone(880, 0.13, 0.045, 0.07);
    },

    /* 不合法 / 被拦下 */
    error() {
      tone(311, 0.06, 0.05, 0, 'triangle');
      tone(233, 0.08, 0.04, 0.055, 'triangle');
    },

    /* 滑块咔哒 */
    tick() {
      tone(2200, 0.022, 0.05, 0, 'square');
    },

    /* 轮到下一位玩家：两声上行，短促不抢戏 */
    turn() {
      tone(784, 0.05, 0.04);
      tone(1175, 0.07, 0.035, 0.055);
    },

    /* 终局 */
    win() {
      [880, 1108, 1318, 1760].forEach(function (f, i) {
        tone(f, 0.18, 0.05, i * 0.1);
      });
    },
  };

  /* ------------------------------------------------------------ 持久化 */

  function loadTune() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(TUNE_KEY);
      tuning = mergeTune(raw ? JSON.parse(raw) : null);
    } catch (e) {
      tuning = defaultTune();
    }
    return tuning;
  }

  function saveTune(patch) {
    tuning = mergeTune(patch || tuning);
    try {
      root.localStorage.setItem(TUNE_KEY, JSON.stringify(tuning));
    } catch (e) { /* 存不了就算了，本次会话仍然生效 */ }
    return tuning;
  }

  function resetTune() {
    tuning = defaultTune();
    try { root.localStorage.removeItem(TUNE_KEY); } catch (e) { /* 忽略 */ }
    return tuning;
  }

  loadTune();

  /* --------------------------------------------------------------- 导出 */

  root.Sfx = {
    play: function (name) {
      if (!enabled) return;
      const fn = SOUNDS[name];
      if (!fn) return;
      active = tuning[name] || null;
      try { fn(); } catch (e) { /* 音频不可用时静默跳过 */ }
      active = null;
    },

    setEnabled: function (value) { enabled = !!value; },
    isEnabled: function () { return enabled; },

    setVolume: function (v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (master) master.gain.value = 2.0 * volume;
    },
    getVolume: function () { return volume; },

    /* ---- 调校 ---- */
    SOUND_NAMES: SOUND_NAMES,
    TUNE_KEY: TUNE_KEY,
    defaultTune: defaultTune,
    getTuning: function () { return JSON.parse(JSON.stringify(tuning)); },
    setTuning: function (patch) { tuning = mergeTune(patch); return tuning; },
    saveTuning: function (patch) { return saveTune(patch); },
    resetTuning: function () { return resetTune(); },
    loadTuning: function () { return loadTune(); },

    /**
     * 试听：临时套用一份调校再播放，播完立刻还原（不写入）。
     */
    preview: function (name, patch) {
      if (!SOUNDS[name]) return;
      const prev = tuning[name];
      if (patch) tuning[name] = mergeTune({ [name]: patch })[name];

      const was = enabled;
      enabled = true;
      this.play(name);
      enabled = was;

      tuning[name] = prev;
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
