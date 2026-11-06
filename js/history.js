/* ==========================================================================
   并购风云 · 历史战绩详情（数据分析页）

   目标：像一份「对局分析报告」，而不是一张成绩单。

   结构（自上而下）：
     1. 顶部栏：标题、人数、回合数、返回
     2. KPI 指标条：冠军、领先优势、全场分红、并购次数、现金峰值
     3. 左：现金走势 / 持股走势（带坐标轴、悬停读数、可点击跳转）
        右：终局结算表 + 结算前持股
     4. 领先回合占比（谁在什么时候压着打）
     5. 逐回合明细表（可点行跳转）

   数据来自 career.js 的 replays：每局一串回合快照 + 终局结算结果。
   ========================================================================== */

(function (root) {
  'use strict';

  let record = null;
  let index = 0;
  let timer = null;
  let hoverIndex = -1;

  const COLORS = ['#6faa55', '#d4b062', '#58b8e8', '#e5484d', '#9161d9', '#e8863a'];

  function $(sel) { return document.querySelector(sel); }
  function pad(n) { return String(n).padStart(2, '0'); }

  function stamp(at) {
    const d = new Date(at);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function companyTable() {
    return (window.COMPANIES_UI || []).reduce((m, c) => {
      m[c.id] = c;
      return m;
    }, {});
  }

  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  /** 玩家颜色：优先用对局里记录的颜色，老记录退回默认色板 */
  function colorOf(pi) {
    return (record.colors && record.colors[pi]) || COLORS[pi % COLORS.length];
  }

  /**
   * 玩家头像。
   * 与牌桌座位上的头像同一套视觉：圆形、该玩家的颜色、中间是座次编号。
   */
  function avatar(pi) {
    return '<span class="p-avatar" style="--p:' + colorOf(pi) + '">' + (pi + 1) + '</span>';
  }

  function stocksOf(p) {
    return Object.keys((p && p.stocks) || {})
      .filter((id) => p.stocks[id] > 0)
      .map((id) => ({ id: id, count: p.stocks[id] }));
  }

  function totalStocks(p) {
    return stocksOf(p).reduce((n, s) => n + s.count, 0);
  }

  function frames() { return record.frames; }

  function lastFrame() { return record.frames[record.frames.length - 1]; }

  function finalOf(pi) {
    if (record.final && record.final[pi]) return record.final[pi];
    return null;
  }

  /* ------------------------------------------------------------ 统计 */

  function computeStats() {
    const fs = frames();
    const n = record.names.length;

    const order = (record.ranks && record.ranks.length) ? record.ranks : record.names.map((_, i) => i);

    // 终局现金：优先用结算结果，老记录退回最后一帧
    const finalCash = record.names.map((_, pi) => {
      const f = finalOf(pi);
      return f ? f.cash : ((lastFrame().players[pi] || {}).cash || 0);
    });

    const totalDividend = record.names.reduce((sum, _, pi) => {
      const f = finalOf(pi);
      return sum + (f ? f.dividend || 0 : 0);
    }, 0);

    const mergers = fs.filter((f) => (f.events || []).indexOf('merge') >= 0).length;
    const founds = fs.filter((f) => (f.events || []).indexOf('found') >= 0).length;

    // 现金峰值
    let peak = { cash: 0, player: 0, round: 0 };
    fs.forEach((f) => {
      (f.players || []).forEach((p, pi) => {
        if (p.cash > peak.cash) peak = { cash: p.cash, player: pi, round: f.round };
      });
    });

    // 领先回合：每一帧里现金最多的人
    const lead = new Array(n).fill(0);
    fs.forEach((f) => {
      let best = -1;
      let bestCash = -1;
      (f.players || []).forEach((p, pi) => {
        if (p.cash > bestCash) { bestCash = p.cash; best = pi; }
      });
      if (best >= 0) lead[best] += 1;
    });

    const winner = order[0];
    const second = order[1];
    const margin = second == null ? 0 : finalCash[winner] - finalCash[second];

    return {
      order: order,
      finalCash: finalCash,
      totalDividend: totalDividend,
      mergers: mergers,
      founds: founds,
      peak: peak,
      lead: lead,
      winner: winner,
      margin: margin,
      rounds: fs.length,
    };
  }

  /* ------------------------------------------------------------ 图表 */

  /**
   * 面积图：折线 + 线下填充。
   * 纵轴按本图最大值归一，左上有 Y 轴上限，底部有 X 轴刻度。
   */
  function areaChart(series, opts) {
    const fs = frames();
    const n = fs.length;
    const W = 100;
    const H = 100;

    let max = 1;
    series.forEach((s) => s.values.forEach((v) => { if (v > max) max = v; }));
    max = opts.ceil ? opts.ceil(max) : max;

    let area = '';
    let lines = '';

    series.forEach((s) => {
      const pts = s.values.map((v, k) => {
        const x = n <= 1 ? 0 : (k / (n - 1)) * W;
        const y = H - (v / max) * (H - 4) - 1;
        return [x, y];
      });

      const d = pts.map(([x, y], k) => (k ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2)).join(' ');
      const fill = d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';

      area += '<path d="' + fill + '" fill="' + s.color + '" opacity="0.1"></path>';
      // 当前帧处的数据点，像分析软件那样标出来
      const p0 = pts[index] || pts[0];
      if (p0) {
        area += '<circle class="chart-dot" cx="' + p0[0].toFixed(2) + '" cy="' + p0[1].toFixed(2)
          + '" r="1.4" fill="' + s.color + '"></circle>';
      }

      lines += '<path d="' + d + '" fill="none" stroke="' + s.color
        + '" stroke-width="1.6" vector-effect="non-scaling-stroke"></path>';
    });

    // 网格
    const grid = [0.25, 0.5, 0.75].map((g) =>
      '<line x1="0" y1="' + (H * g).toFixed(1) + '" x2="' + W + '" y2="' + (H * g).toFixed(1)
      + '" stroke="rgba(255,255,255,0.055)" stroke-width="0.5" vector-effect="non-scaling-stroke"></line>'
    ).join('');

    // 当前帧与悬停帧的游标
    const cx = (i) => (n <= 1 ? 0 : (i / (n - 1)) * W);
    const cursor = '<line class="chart-cursor" x1="' + cx(index) + '" y1="0" x2="' + cx(index) + '" y2="' + H
      + '" stroke="rgba(240,215,155,0.85)" stroke-width="0.9" vector-effect="non-scaling-stroke"></line>';

    const hover = hoverIndex >= 0
      ? '<line x1="' + cx(hoverIndex) + '" y1="0" x2="' + cx(hoverIndex) + '" y2="' + H
        + '" stroke="rgba(255,255,255,0.35)" stroke-width="0.7" stroke-dasharray="2 2"'
        + ' vector-effect="non-scaling-stroke"></line>'
      : '';

    return '<div class="chart-box">'
      + '<div class="chart-y">' + opts.fmt(max) + '<i>' + opts.fmt(max / 2) + '</i><b>0</b></div>'
      + '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"'
      +   ' data-kind="' + opts.kind + '">'
      +   grid + area + lines + hover + cursor
      + '</svg>'
      + '<div class="chart-x"><span>第 1 回合</span>'
      + '<span>第 ' + fs[Math.floor((n - 1) / 2)].round + ' 回合</span>'
      + '<span>第 ' + fs[n - 1].round + ' 回合</span></div>'
      + '</div>';
  }

  /* ------------------------------------------------------------ 区块 */

  function kpiSection(st) {
    const winnerName = record.names[st.winner] || '';
    const peakName = record.names[st.peak.player] || '';
    const isWin = (record.humans || []).indexOf(st.winner) >= 0;

    const cell = (label, value, note, cls) =>
      '<div class="kpi' + (cls ? ' ' + cls : '') + '">'
      + '<span class="kpi-label">' + label + '</span>'
      + '<b class="kpi-value">' + value + '</b>'
      + '<span class="kpi-note">' + note + '</span>'
      + '</div>';

    return '<section class="history-kpis">'
      + cell('冠军', winnerName, money(st.finalCash[st.winner]) + (isWin ? ' · 你' : ''), 'is-gold')
      + cell('领先优势', money(st.margin), '与第二名的差距')
      + cell('全场分红', money(st.totalDividend), '终局一次性发放')
      + cell('并购 / 创立', st.mergers + ' / ' + st.founds, '整局触发次数')
      + cell('现金峰值', money(st.peak.cash), peakName + ' · 第 ' + st.peak.round + ' 回合')
      + '</section>';
  }

  function settlementSection(st) {
    const last = lastFrame();

    const rows = st.order.map((pi, k) => {
      const f = finalOf(pi);
      const before = (last.players[pi] || {}).cash || 0;
      const div = f ? f.dividend || 0 : 0;
      const sale = f ? f.sale || 0 : 0;
      const cash = st.finalCash[pi];

      return '<tr class="' + (k === 0 ? 'is-first' : '') + '">'
        + '<td class="col-rank">' + (k === 0 ? '★' : '') + (k + 1) + '</td>'
        + '<td class="col-name">' + (record.names[pi] || '') + '</td>'
        + '<td>' + money(before) + '</td>'
        + '<td class="col-gain">+' + money(div) + '</td>'
        + '<td class="col-gain">+' + money(sale) + '</td>'
        + '<td class="col-strong">' + money(cash) + '</td>'
        + '</tr>';
    }).join('');

    return '<section class="history-panel">'
      + '<header class="panel-head"><h3>终局结算</h3>'
      + '<span>分红与变卖在终局一次性发放</span></header>'
      + '<table class="data-table">'
      + '<thead><tr><th>名次</th><th>玩家</th><th>结算前</th><th>分红</th><th>变卖</th><th>最终</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + '</section>';
  }

  function holdingsSection() {
    const last = lastFrame();
    const byId = companyTable();

    const cards = record.names.map((name, pi) => {
      const p = last.players[pi] || { stocks: {} };
      const chips = stocksOf(p).map((s) => {
        const c = byId[s.id] || { mark: '?', color: '#888888' };
        return '<span class="holding-chip" style="--c:' + c.color + '">'
          + c.mark + '<b>' + s.count + '</b></span>';
      }).join('') || '<em class="muted">无持股</em>';

      return '<div class="holding-row">'
        + '<span class="holding-name">' + name + '</span>'
        + '<span class="holding-chips">' + chips + '</span>'
        + '<span class="holding-total">' + totalStocks(p) + ' 张</span>'
        + '</div>';
    }).join('');

    return '<section class="history-panel">'
      + '<header class="panel-head"><h3>结算前持股</h3>'
      + '<span>最后一回合结束时的持仓</span></header>'
      + '<div class="holding-list-box">' + cards + '</div>'
      + '</section>';
  }

  function leadSection(st) {
    const rows = record.names.map((name, pi) => {
      const ratio = st.rounds ? (st.lead[pi] / st.rounds) * 100 : 0;
      return '<div class="lead-row">'
        + '<span class="lead-name">' + avatar(pi) + name + '</span>'
        + '<span class="lead-bar"><i style="width:' + ratio.toFixed(1) + '%;background:'
        + colorOf(pi) + '"></i></span>'
        + '<span class="lead-val">' + st.lead[pi] + ' / ' + st.rounds + ' 回合</span>'
        + '</div>';
    }).join('');

    return '<section class="history-panel">'
      + '<header class="panel-head"><h3>领先回合</h3>'
      + '<span>每一回合现金最多的人</span></header>'
      + '<div class="lead-box">' + rows + '</div>'
      + '</section>';
  }

  function chartsSection() {
    const fs = frames();

    const cashSeries = record.names.map((name, pi) => ({
      color: colorOf(pi),
      values: fs.map((f) => ((f.players[pi] || {}).cash) || 0),
    }));

    const stockSeries = record.names.map((name, pi) => ({
      color: colorOf(pi),
      values: fs.map((f) => totalStocks(f.players[pi] || {})),
    }));

    const legend = record.names.map((name, pi) =>
      '<span class="legend-item">' + avatar(pi) + name + '</span>').join('');

    return '<section class="history-panel history-charts">'
      + '<header class="panel-head"><h3>走势</h3>'
      + '<span class="legend-row">' + legend + '</span></header>'
      + '<div class="chart-pair">'
      +   '<div class="chart-cell">'
      +     '<span class="chart-title">现金</span>'
      +     areaChart(cashSeries, { kind: 'cash', fmt: money })
      +   '</div>'
      +   '<div class="chart-cell">'
      +     '<span class="chart-title">持股张数</span>'
      +     areaChart(stockSeries, { kind: 'stock', fmt: (v) => Math.round(v) + ' 张' })
      +   '</div>'
      + '</div>'
      + '</section>';
  }

  function scrubSection() {
    return '<section class="history-panel history-scrub">'
      + '<header class="panel-head"><h3>逐回合查看</h3>'
      + '<span id="historyFrameLabel">第 1 回合</span></header>'
      + '<div class="scrub-bar">'
      +   '<button class="ghost-btn" id="historyPlay">播放</button>'
      +   '<input type="range" id="historyRange" min="0" max="' + (frames().length - 1) + '" value="0">'
      +   '<span class="scrub-readout" id="historyReadout"></span>'
      + '</div>'
      + '<div class="frame-body" id="historyFrameBody"></div>'
      + '</section>';
  }

  function detailTableSection() {
    const fs = frames();

    const head = record.names.map((n, pi) =>
      '<th><i class="th-dot" style="background:' + colorOf(pi) + '"></i>' + n + '</th>').join('');

    const rows = fs.map((f, k) => {
      const cells = record.names.map((name, pi) => {
        const p = f.players[pi] || { cash: 0, stocks: {} };
        return '<td><b>' + money(p.cash) + '</b><em>' + totalStocks(p) + ' 张</em></td>';
      }).join('');
      return '<tr data-frame="' + k + '"><th>' + f.round + '</th>' + cells + '</tr>';
    }).join('');

    return '<section class="history-panel history-panel--table">'
      + '<header class="panel-head"><h3>逐回合明细</h3>'
      + '<span>每格：现金 ／ 持股张数 · 点击行可跳转</span></header>'
      + '<div class="detail-table-wrap">'
      + '<table class="data-table is-detail">'
      + '<thead><tr><th>回合</th>' + head + '</tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + '</div>'
      + '</section>';
  }

  /* ------------------------------------------------------------ 当前帧 */

  function renderFrame() {
    const f = frames()[index];
    if (!f) return;

    const label = $('#historyFrameLabel');
    if (label) label.textContent = '第 ' + f.round + ' 回合';

    const body = $('#historyFrameBody');
    if (body) {
      body.innerHTML = record.names.map((name, pi) => {
        const p = f.players[pi] || { cash: 0, stocks: {} };
        return '<div class="frame-player">'
          + avatar(pi)
          + '<b>' + name + '</b>'
          + '<span>' + money(p.cash) + '</span>'
          + '<em>' + totalStocks(p) + ' 张</em>'
          + '</div>';
      }).join('');
    }

    const readout = $('#historyReadout');
    if (readout) {
      const tags = (f.events || []).map((e) => (e === 'merge' ? '并购' : e === 'found' ? '创立公司' : ''))
        .filter(Boolean);
      readout.textContent = tags.length ? tags.join(' / ') : '';
    }

    const range = $('#historyRange');
    if (range) range.value = String(index);

    syncCursor();
  }

  /** 图表游标 + 明细表高亮 */
  function syncCursor() {
    const n = frames().length;
    const x = n <= 1 ? 0 : (index / (n - 1)) * 100;

    document.querySelectorAll('#historyBody .chart-cursor').forEach((line) => {
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
    });

    document.querySelectorAll('#historyBody .data-table.is-detail tr[data-frame]').forEach((tr) => {
      tr.classList.toggle('is-current', Number(tr.dataset.frame) === index);
    });
  }

  /* ------------------------------------------------------------ 播放 */

  function play() {
    pause();
    const btn = $('#historyPlay');
    if (btn) btn.textContent = '暂停';

    timer = setInterval(() => {
      if (index >= frames().length - 1) { pause(); return; }
      index += 1;
      renderFrame();
    }, 700);
  }

  function pause() {
    if (timer) { clearInterval(timer); timer = null; }
    const btn = $('#historyPlay');
    if (btn) btn.textContent = '播放';
  }

  /* ------------------------------------------------------------ 交互 */

  function bindChartHover() {
    document.querySelectorAll('#historyBody .chart-svg').forEach((svg) => {
      const box = svg.parentElement;

      svg.addEventListener('mousemove', (e) => {
        const rect = svg.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const i = Math.round(ratio * (frames().length - 1));

        // 悬停虚线
        document.querySelectorAll('#historyBody .chart-hover').forEach((el) => el.remove());
        const n = frames().length;
        const x = n <= 1 ? 0 : (i / (n - 1)) * 100;

        document.querySelectorAll('#historyBody .chart-svg').forEach((s2) => {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('class', 'chart-hover');
          line.setAttribute('x1', String(x));
          line.setAttribute('x2', String(x));
          line.setAttribute('y1', '0');
          line.setAttribute('y2', '100');
          line.setAttribute('stroke', 'rgba(255,255,255,0.32)');
          line.setAttribute('stroke-dasharray', '2 2');
          line.setAttribute('stroke-width', '0.7');
          line.setAttribute('vector-effect', 'non-scaling-stroke');
          s2.appendChild(line);
        });

        // 读数
        const f = frames()[i];
        if (f) {
          index = i;
          renderFrame();
        }
      });

      svg.addEventListener('mouseleave', () => {
        document.querySelectorAll('#historyBody .chart-hover').forEach((el) => el.remove());
      });

      // 点击定位到该回合
      svg.addEventListener('click', (e) => {
        const rect = svg.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        pause();
        index = Math.round(ratio * (frames().length - 1));
        renderFrame();
      });
    });
  }

  /* ------------------------------------------------------------ 打开 */

  function open(id) {
    let rec = null;
    try {
      rec = window.Career && window.Career.replay(id);
    } catch (e) {
      console.error('[history] 读取记录失败', e);
    }

    if (!rec) {
      if (window.Acquire && window.Acquire.toast) window.Acquire.toast('找不到这一局的记录');
      return;
    }
    if (!rec.frames || !rec.frames.length) {
      if (window.Acquire && window.Acquire.toast) window.Acquire.toast('这一局没有逐回合数据（旧版本记录）');
      return;
    }

    record = rec;
    index = 0;
    hoverIndex = -1;
    pause();

    let st;
    try {
      st = computeStats();
    } catch (e) {
      console.error('[history] 统计失败', e);
      if (window.Acquire && window.Acquire.toast) window.Acquire.toast('这一局的数据不完整，无法生成分析');
      return;
    }

    const title = $('#historyTitle');
    if (title) title.textContent = (rec.mode === 'tycoon' ? '大亨模式' : '经典模式') + ' · ' + stamp(rec.at);

    const hint = $('#historyHint');
    if (hint) hint.textContent = rec.names.length + ' 人 · ' + st.rounds + ' 回合';

    // 顶部加「文字记录」：老对局没有 battle-log，可以在这里补出来
    try { mountExportButton(rec); } catch (e) { console.error('[history] 文字记录按钮失败', e); }

    const body = $('#historyBody');
    if (body) {
      /*
       * 两列各自纵向堆叠，不再分成「两行网格」。
       * 分行的做法会在较短那一列下方留一大片空白 —— 因为下一行要等
       * 最高那一列排完才开始。
       */
      body.innerHTML = kpiSection(st)
        + '<div class="history-grid">'
        +   '<div class="history-col history-col--main">'
        +     chartsSection() + scrubSection() + detailTableSection()
        +   '</div>'
        +   '<div class="history-col history-col--side">'
        +     settlementSection(st) + holdingsSection() + leadSection(st)
        +   '</div>'
        + '</div>';
    }

    const range = $('#historyRange');
    if (range) {
      range.addEventListener('input', () => {
        pause();
        index = Number(range.value);
        renderFrame();
      });
    }

    const playBtn = $('#historyPlay');
    if (playBtn) playBtn.addEventListener('click', () => (timer ? pause() : play()));

    document.querySelectorAll('.data-table.is-detail tr[data-frame]').forEach((tr) => {
      tr.addEventListener('click', () => {
        pause();
        index = Number(tr.dataset.frame);
        renderFrame();
      });
    });

    bindChartHover();
    renderFrame();

    if (window.Acquire && window.Acquire.showScreen) window.Acquire.showScreen('history');
  }

  /* ------------------------------------------------ 复盘导出为文字记录 */

  function companyNameOf(id) {
    const list = window.COMPANIES_UI || [];
    const hit = list.find((c) => c.id === id);
    return hit ? hit.name : id;
  }

  function boardSizes(frame) {
    const sizes = {};
    const board = (frame && frame.board) || {};
    Object.keys(board).forEach((k) => {
      const v = board[k];
      if (typeof v === 'string') sizes[v] = (sizes[v] || 0) + 1;
    });
    return sizes;
  }

  /**
   * 把一局的复盘帧转成可读的文字记录。
   * 用途：老版本对局没有 battle-log，靠这个把历史补成文本。
   */
  function replayToText(rec) {
    const names = rec.names || [];
    const out = [];

    out.push('并购风云 · 对局记录');
    out.push('模式：' + (rec.mode === 'tycoon' ? '大亨模式' : '经典模式')
      + '　时间：' + stamp(rec.at));
    out.push('玩家：' + names.join('、'));
    out.push('');

    let prev = null;

    (rec.frames || []).forEach((f, i) => {
      const sizes = boardSizes(f);
      const round = f.round || (i + 1);

      out.push('第 ' + round + ' 回合');

      /* 公司：规模 + 坐标 */
      Object.keys(sizes).forEach((id) => {
        const cells = Object.keys(f.board || {})
          .filter((k) => f.board[k] === id)
          .map((k) => {
            const p = k.split(',');
            return String.fromCharCode(65 + Number(p[0])) + (Number(p[1]) + 1);
          });
        out.push(companyNameOf(id) + ' 规模' + sizes[id] + '：' + cells.join('、'));
      });

      /* 空白格 */
      const empty = [];
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 12; c++) {
          if ((f.board || {})[c + ',' + r] === undefined) {
            empty.push(String.fromCharCode(65 + c) + (r + 1));
          }
        }
      }
      out.push('空白格：' + (empty.length ? empty.join('、') : '无'));

      /* 每位玩家一行 */
      names.forEach((n, pi) => {
        const p = (f.players && f.players[pi]) || {};
        const held = Object.keys(p.stocks || {})
          .filter((id) => p.stocks[id] > 0)
          .map((id) => companyNameOf(id) + p.stocks[id]);
        out.push('[汇总] ' + n + '：$' + (p.cash || 0)
          + '、持股：' + (held.length ? held.join('/') : '—'));
      });

      /* 与上一帧的变化 */
      if (prev) {
        const added = [];
        Object.keys(f.board || {}).forEach((k) => {
          if ((prev.board || {})[k] === undefined) {
            const p = k.split(',');
            const label = String.fromCharCode(65 + Number(p[0])) + (Number(p[1]) + 1);
            added.push(label + (f.board[k] ? '→' + companyNameOf(f.board[k]) : ''));
          }
        });
        if (added.length) out.push('[变化] 新增板块：' + added.join('、'));

        names.forEach((n, pi) => {
          const a = (prev.players && prev.players[pi]) || {};
          const b = (f.players && f.players[pi]) || {};
          const dc = (b.cash || 0) - (a.cash || 0);
          if (dc !== 0) out.push('[变化] ' + n + ' 现金 ' + (dc > 0 ? '+' : '') + dc
            + ' → $' + (b.cash || 0));
        });
      }

      if (f.events && f.events.length) {
        const zh = { found: '创立公司', merge: '并购' };
        f.events.forEach((e) => out.push('[事件] ' + (zh[e] || e)));
      }

      out.push('');
      prev = f;
    });

    return out.join('\n').trim();
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
      return true;
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  /** 在详情页顶部加一个「文字记录」按钮 */
  function mountExportButton(rec) {
    const host = document.querySelector('.history-topbar') || (document.getElementById('historyTitle') || {}).parentNode;
    if (!host) return;

    let btn = document.getElementById('historyExport');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'historyExport';
      btn.className = 'ghost-btn';
      btn.textContent = '文字记录';
      btn.style.marginLeft = '10px';
      host.appendChild(btn);
    }

    btn.onclick = () => {
      const text = replayToText(rec);
      window.Acquire.openModal({
        title: '文字记录',
        subtitle: '由复盘数据还原 · 可直接复制',
        body: '<p class="battle-log-hint">这是根据历史复盘帧还原的文字记录。</p>'
          + '<pre class="battle-log">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>',
        actions: [{
          label: '复制记录',
          className: 'btn--gold',
          onClick: (e) => {
            const ok = copyText(text);
            if (e && e.target) e.target.textContent = ok ? '已复制' : '请手动全选复制';
          },
        }],
      });
    };
  }

  function close() {
    pause();
    record = null;

    // 返回的是「历史战绩」这份列表，不是主菜单
    if (window.Acquire && window.Acquire.showScreen) window.Acquire.showScreen('menu');
    if (window.showHistoryList) {
      window.showHistoryList();
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'historyBack') close();
  });

  root.History = { open: open, close: close };
})(typeof window !== 'undefined' ? window : globalThis);
