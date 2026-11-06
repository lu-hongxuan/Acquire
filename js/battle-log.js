/* ==========================================================================
   并购风云 · 对局记录（文字版）

   把一局游戏按「回合」切成文本，供事后复盘：
     第 1 回合
       玩家 1 在 D4 放置板块
       玩家 2 买入 2 张 萨科森
       ……

   设计约束：
   - 只保留最近 10 个回合（避免无限增长，内存与可读性都受不了）
   - 不依赖 DOM，纯数据，可单独测试
   - 由 board.js 在关键节点调用 add()，模块自己负责排版
   ========================================================================== */

(function (root) {
  'use strict';

  var KEEP_ROUNDS = 10;

  var data = null;

  /** 开新局：记录基本信息，清掉上一局 */
  function begin(meta) {
    data = {
      meta: meta || {},
      rounds: [],          // [{ n, lines: [] }]
      current: null,
      ended: null,
    };
    startRound(1);
  }

  function ensure() {
    if (!data) begin({});
    return data;
  }

  function startRound(n) {
    var d = ensure();
    d.current = { n: n, lines: [] };
    d.rounds.push(d.current);

    // 只留最近 10 回合
    while (d.rounds.length > KEEP_ROUNDS) d.rounds.shift();
  }

  /** 切到某一回合；重复调用同一回合不会重复插入 */
  function round(n) {
    var d = ensure();
    if (d.current && d.current.n === n) return;
    startRound(n);
  }

  /** 追加一行 */
  function add(text) {
    if (!text) return;
    var d = ensure();
    if (!d.current) startRound(1);
    d.current.lines.push(String(text));
  }

  /** 终局结语（不进回合，放在末尾） */
  function finish(text) {
    var d = ensure();
    d.ended = text ? String(text) : d.ended;
  }

  /** 拼成纯文本 */
  function toText() {
    var d = ensure();
    var out = [];
    var m = d.meta || {};

    if (m.title) out.push(m.title);
    if (m.mode) out.push('模式：' + m.mode);
    if (m.players && m.players.length) {
      out.push('玩家：' + m.players.map(function (p) {
        return p.name + (p.isAi ? '（AI·' + (p.difficulty || '') + '）' : '（玩家）');
      }).join('　'));
    }
    if (out.length) out.push('');

    d.rounds.forEach(function (r) {
      out.push('第 ' + r.n + ' 回合');
      if (!r.lines.length) out.push('  （本回合没有记录）');
      r.lines.forEach(function (line) { out.push('  ' + line); });
      out.push('');
    });

    if (d.ended) out.push(d.ended);
    return out.join('\n').replace(/\n+$/, '');
  }

  /** 当前快照（给调试/导出用） */
  function snapshot() {
    return JSON.parse(JSON.stringify(ensure()));
  }

  function reset() {
    data = null;
  }

  var api = {
    KEEP_ROUNDS: KEEP_ROUNDS,
    begin: begin,
    round: round,
    add: add,
    finish: finish,
    toText: toText,
    snapshot: snapshot,
    reset: reset,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BattleLog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
