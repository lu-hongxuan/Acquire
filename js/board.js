/* ==========================================================================
   并购风云 · 游戏桌面 / 牌桌
   当前阶段：视觉原型。只做渲染与摆放演示，不含规则校验。

   座位模型：
   - 当前行动的玩家坐在下方（操作区，显示手牌）。
   - 其余玩家按顺时针坐在左侧 / 对面 / 右侧，每回合随行动者轮转。
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- 委托
   * 证书绘制已移到 js/board-certs.js（重构第一步）。
   * 这里保留同名薄封装，所有调用点一行都不用改。
   */

  function hexToRgba(hex, alpha) { return window.BoardCerts.hexToRgba(hex, alpha); }
  function isLight(hex) { return window.BoardCerts.isLight(hex); }
  function buildingSVG(id) { return window.BoardCerts.buildingSVG(id); }
  function sealSVG(mark, variant) { return window.BoardCerts.sealSVG(mark, variant); }
  function frameSVG(w, h) { return window.BoardCerts.frameSVG(w, h); }
  function miniCardHTML(c, count) { return window.BoardCerts.miniCardHTML(c, count); }
  function fullCertHTML(c, count) { return window.BoardCerts.fullCertHTML(c, count); }

  /* ---------------------------------------------------------------- 委托
   * 股票处置的计算已移到 js/stock-disposal.js（重构第三步）。
   * 这里保留同名薄封装，调用点不用改；install 在文件末尾执行。
   */

  function orderedHolders(companyId) { return window.StockDisposal.orderedHolders(companyId); }
  function settleStockPlayer(idx) { return window.StockDisposal.settleStockPlayer(idx); }
  function applyStocks(loserId, size) { return window.StockDisposal.applyStocks(loserId, size); }
  function refreshStockPoolLabel() { return window.StockDisposal.refreshPoolLabel(); }


  /* ---------------------------------------------------------------- 委托
   * 通用工具已移到 js/board-utils.js。
   */

  function companyName(id) { return window.BoardUtils.companyName(id, COMPANY_BY_ID); }
  function buildCareerPanel(newly) { return window.BoardUtils.buildCareerPanel(newly); }

  /* ---------------------------------------------------------------- 委托
   * 股票处置的全套（界面片段 + 决策 + 结算）已移到 js/stock-disposal.js。
   */

  function stageStocks(loserId, size) { return window.StockDisposal.stageStocks(loserId, size); }

  /* ---------------------------------------------------------------- 常量 */

  const COLS = 12;
  const ROWS = 9;
  const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

  /**
   * 公司的外观与价位档。
   * 名称统一从引擎取（AcquireEngine.COMPANIES），这里只放颜色、标记和档位，
   * 避免两处各写一份名字导致不同步。
   *
   * 档位：0 = 小规模（标准档）、1 = 中等规模、2 = 大规模。
   * 档位加 1 等价于规模上调一档。
   */
  const COMPANY_DISPLAY = {
    saxony:      { mark: 'S', color: '#e5484d', tier: 0 },   // 红
    tower:       { mark: 'T', color: '#e8b931', tier: 0 },   // 黄
    america:     { mark: 'A', color: '#2f5fd0', tier: 1 },   // 深蓝
    festival:    { mark: 'F', color: '#35b56a', tier: 1 },   // 绿
    worldwide:   { mark: 'W', color: '#9161d9', tier: 1 },   // 紫
    continental: { mark: 'C', color: '#58b8e8', tier: 2 },   // 浅蓝
    imperial:    { mark: 'I', color: '#e8863a', tier: 2 },   // 橙
  };

  const COMPANIES = window.AcquireEngine.COMPANIES.map((c) => {
    const d = COMPANY_DISPLAY[c.id] || { mark: '?', color: '#888888', tier: 0 };
    return { id: c.id, name: c.name, mark: d.mark, color: d.color, tier: d.tier };
  });

  // 复盘模块也要用（颜色、字母、档位都在这里，引擎里没有）
  window.COMPANIES_UI = COMPANIES;

  /** 档位在界面上的叫法 */
  const TIER_NAMES = ['小', '中', '大'];

  /** 出厂名称，用来支持「恢复默认」 */
  const DEFAULT_COMPANY = {};
  COMPANIES.forEach((c) => { DEFAULT_COMPANY[c.id] = { name: c.name, mark: c.mark }; });

  /**
   * 应用设置里自定义的公司名字与缩写。
   * 只改名字和字母，颜色与价位档是规则的一部分，不允许改。
   */
  window.applyCompanyNames = function (map) {
    COMPANIES.forEach((c) => {
      const o = (map && map[c.id]) || {};
      const name = (o.name || '').trim();
      const mark = (o.mark || '').trim();
      c.name = name || DEFAULT_COMPANY[c.id].name;
      c.mark = mark || DEFAULT_COMPANY[c.id].mark;
    });

    if (window.AcquireEngine && window.AcquireEngine.setCompanyNames) {
      window.AcquireEngine.setCompanyNames(map);
    }

    if (state.game) render();
  };

  /** 给设置面板用：导出一份当前公司信息 */
  window.AcquireCompanies = function () {
    return COMPANIES.map((c) => ({ id: c.id, name: c.name, mark: c.mark, color: c.color, tier: c.tier }));
  };

  const COMPANY_BY_ID = {};
  COMPANIES.forEach((c) => { COMPANY_BY_ID[c.id] = c; });

  /**
   * 股价阶梯（照抄实体股东信息卡的价格列，共 11 档）。
   * 最后两档（$1,100 / $1,200）是给高两档公司达到 41 块时预留的。
   */
  const PRICE_LADDER = [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200];

  /** 规模 → 阶梯下标（未加档位偏移） */
  const SIZE_STEPS = [
    { min: 41, step: 8 },
    { min: 31, step: 7 },
    { min: 21, step: 6 },
    { min: 11, step: 5 },
    { min: 6,  step: 4 },
    { min: 5,  step: 3 },
    { min: 4,  step: 2 },
    { min: 3,  step: 1 },
    { min: 2,  step: 0 },
  ];

  /** 每个阶梯下标的规模文本（与实体卡一致） */
  const STEP_LABELS = ['2', '3', '4', '5', '6–10', '11–20', '21–30', '31–40', '41 及以上', '—', '—'];

  /**
   * 公司价位档：0 = 小规模，1 = 中等规模，2 = 大规模。
   * 档位加 1 等价于规模上调一档。
   * 数值来自 COMPANY_DISPLAY，这里只是给查表用的索引。
   */
  const COMPANY_TIER = {};
  COMPANIES.forEach((c) => { COMPANY_TIER[c.id] = c.tier; });

  /**
   * 大亨模式分红（照抄实体卡，按阶梯下标 0–10）。
   * 第一大股东恒为股价 × 10，不必单独存。
   */
  const TYCOON_PAYOUT = {
    second: [1500, 2200, 3000, 3700, 4200, 5200, 6200, 6200, 7700, 7700, 8200],
    third:  [1000, 1500, 2000, 2500, 3000, 4000, 5000, 5500, 5500, 6000, 6000],
  };

  const SAFE_SIZE = 11;
  const START_CASH = 6000;
  const HAND_SIZE = 6;

  /**
   * 手牌区该显示多少个牌位。
   * = max(标准手牌数 6, 当前实际手牌数)
   * 平时就是 6 个；某些规则让手牌超过 6 张时按实际数量显示。
   */
  function handSlotCount() {
    const hand = state.hands[state.viewer] || [];
    return Math.max(HAND_SIZE, hand.length);
  }

  /*
   * 手牌尺寸不再硬编码：直接从 CSS 变量 --cell 读，
   * 这样手牌、飞行牌、棋盘格三者永远同尺寸，落地时不会缩放。
   */
  function tileSize() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--cell').trim();
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 62;
  }

  // AI 难度的显示名
  const DIFF_NAME = { easy: '简单', normal: '普通', hard: '困难' };

  const PLAYER_COLORS = ['#d4b062', '#5b9bd5', '#7bc47f', '#e0837a', '#b98cd8', '#5fbfb4'];

  /** 低于这个宽度就不再使用左右侧席位，全部排到对面 */
  const RAIL_BREAKPOINT = 1240;

  /* ---------------------------------------------------------------- 状态 */

  const state = {
    game: null,                  // 引擎对象：棋盘与公司状态的唯一真相
    hands: [],                   // 每位玩家一副手牌：hands[i] = [[c, r], ...]
    selected: -1,
    players: [],
    current: 0,
    round: 1,
    mode: 'classic',             // classic | tycoon
    phase: 'place',              // place = 放置板块，buy = 购买股票
    bought: 0,                   // 本回合已买股票张数
    over: false,                 // 游戏是否已结束
    target: null,                // 选中手牌后要放置的格子 { c, r, legal, analysis }
    deck: [],                    // 全局共用牌堆（108 块地块只有一份）
    shares: {},                  // companyId -> 股票市场里剩余的张数
    viewer: 0,                   // 操作区显示的是哪一位（始终是你操控的角色）
    openInfo: true,              // 信息公开：其他玩家的现金与持股是否可见
    lastSeatHand: [],            // 上一次渲染时各玩家的手牌数，用来触发补牌动画
    lastHandLen: [],             // 上一次渲染时各玩家的手牌张数，用来触发「刚补牌」动画
    humans: [0],                 // 你操控的角色下标（没开局时也要有默认值）
    aiDifficulty: 'normal',
    waitTime: 'medium',
    startedAt: 0,
    endedAt: 0,
    paused: false,
    actionTick: 0,
  };

  /* ---------------------------------------------------------------- 工具 */

  const $ = (sel) => document.querySelector(sel);

  const cellKey = (c, r) => `${c},${r}`;
  const coordLabel = (c, r) => `${COL_LABELS[c]}${r + 1}`;
  const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

  function neighbors(c, r) {
    return [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]].filter(([x, y]) => inBounds(x, y));
  }

  function companyAt(c, r) {
    const v = state.game.board[cellKey(c, r)];
    return typeof v === 'string' ? v : null;
  }

  /** 读某个格子的板块：undefined = 空，null = 零散板块，字符串 = 公司 */
  function tileAt(c, r) {
    return state.game.board[cellKey(c, r)];
  }



  function toast(msg) {
    if (window.Acquire && window.Acquire.toast) window.Acquire.toast(msg);
  }

  /** 播一个音效（受设置里的音效开关控制） */
  function sfx(name) {
    if (window.Sfx) window.Sfx.play(name);
  }

  /** 报错提示 + 错误音 */
  function warn(msg) {
    toast(msg);
    sfx('error');
  }





  /* ------------------------------------------------------------ 棋盘构建 */

  const cellEls = [];   // 按 (r * COLS + c) 顺序

  function buildBoard() {
    $('#boardCols').innerHTML = COL_LABELS.map((l) => `<span>${l}</span>`).join('');
    $('#boardRows').innerHTML = Array.from({ length: ROWS }, (_, i) => `<span>${i + 1}</span>`).join('');

    const gridEl = $('#boardGrid');
    const frag = document.createDocumentFragment();

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.c = String(c);
        cell.dataset.r = String(r);
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', coordLabel(c, r));

        // 每格印上自己的坐标，和实体棋盘一致
        const coord = document.createElement('span');
        coord.className = 'cell-coord';
        coord.textContent = coordLabel(c, r);
        cell.appendChild(coord);

        frag.appendChild(cell);
        cellEls.push(cell);
      }
    }

    gridEl.innerHTML = '';
    gridEl.appendChild(frag);
  }

  /* ------------------------------------------------------------ 自适应尺寸 */

  function layoutBoard() {
    const mid = document.querySelector('.table-mid');
    const frame = $('#boardFrame');
    const leftRail = $('#seatsLeft');
    const rightRail = $('#seatsRight');
    if (!mid || !frame) return;

    const PAD = 16;        // .board-frame 内边距
    const FRAME_GAP = 7;   // .board-frame 的 grid gap
    const LABEL = 22;      // 外圈坐标占位
    const CELL_GAP = 4;    // 格子间距
    const RAIL_GAP = 14;   // .table-center 的 gap

    // 量父容器而不是 board-area，避免尺寸反馈循环
    let railWidth = 0;
    if (leftRail && leftRail.offsetParent !== null) railWidth += leftRail.offsetWidth + RAIL_GAP;
    if (rightRail && rightRail.offsetParent !== null) railWidth += rightRail.offsetWidth + RAIL_GAP;

    const availW = mid.clientWidth - railWidth - PAD * 2 - LABEL - FRAME_GAP - (COLS - 1) * CELL_GAP;
    const availH = mid.clientHeight - PAD * 2 - LABEL - FRAME_GAP - (ROWS - 1) * CELL_GAP;

    if (availW <= 0 || availH <= 0) return;

    const cell = Math.floor(Math.min(availW / COLS, availH / ROWS));
    const clamped = Math.max(16, Math.min(cell, 92));

    // 防抖：小幅波动不重设，避免棋盘一抽一抽地缩放
    if (frame._cell === undefined || Math.abs(clamped - frame._cell) >= 2) {
      frame._cell = clamped;
      frame.style.setProperty('--cell', clamped + 'px');
      // 同时挂到根节点，让托盘里的手牌也用同一个尺寸（落地时大小完全不变）
      document.documentElement.style.setProperty('--cell', clamped + 'px');
      frame.style.setProperty('--gap', CELL_GAP + 'px');
    }
  }

  /* ------------------------------------------------------------ 公司统计 */

  function computeSizes() {
    const sizes = {};
    COMPANIES.forEach((c) => { sizes[c.id] = 0; });
    for (const k in state.game.board) {
      const id = state.game.board[k];
      if (typeof id === 'string') sizes[id] = (sizes[id] || 0) + 1;
    }
    return sizes;
  }

  /** 规模 + 公司档位 → 价格阶梯下标 */
  function stepOf(size, companyId) {
    if (size < 2) return null;
    const offset = COMPANY_TIER[companyId] || 0;
    for (const entry of SIZE_STEPS) {
      if (size >= entry.min) return Math.min(entry.step + offset, PRICE_LADDER.length - 1);
    }
    return null;
  }

  function priceOf(size, companyId) {
    const step = stepOf(size, companyId);
    return step === null ? null : PRICE_LADDER[step];
  }

  /** 某规模下各名次的分红（区分模式） */
  function payouts(size, companyId) {
    const step = stepOf(size, companyId);
    if (step === null) return null;

    const price = PRICE_LADDER[step];
    const first = price * 10;

    if (state.mode === 'tycoon') {
      return { first, second: TYCOON_PAYOUT.second[step], third: TYCOON_PAYOUT.third[step] };
    }
    return { first, second: price * 5, third: 0 };
  }

  /* ------------------------------------------------------------ 渲染：棋盘 */

  /**
   * 棋盘格子：这里把 state 翻译成视图对象，
   * 具体怎么刷 class 与颜色在 js/board-view-board.js。
   */
  function renderBoard(sizes) {
    window.BoardViewBoard.render({
      cells: cellEls,
      target: state.target,
      tileAt: (c, r) => tileAt(c, r),
      coordLabel: (c, r) => coordLabel(c, r),
      companyById: COMPANY_BY_ID,
      isLight: (hex) => isLight(hex),
      safeSize: SAFE_SIZE,
      sizes,
    });
  }

  /* ---------------------------------------------------------- 渲染：公司 */

  function renderCompanies(sizes) { return window.BoardViewCompanies.render(sizes); }

  /* ------------------------------------------------------------ 股票卡 */

  /**
   * 每家公司的楼体剪影都不一样。
   * viewBox 统一 100×150，底部对齐，颜色由 currentColor 继承。
   */
  let certPreviewEl = null;

  function closeCertPreview() {
    if (!certPreviewEl) return;
    const el = certPreviewEl;
    certPreviewEl = null;
    el.classList.remove('is-open');
    setTimeout(() => el.remove(), 260);
  }

  function openCertPreview(card) {
    const cid = card.dataset.cid;
    const c = COMPANY_BY_ID[cid];
    const p = state.players[state.viewer];
    if (!c || !p) return;

    const count = (p.stocks && p.stocks[cid]) || 0;
    if (!count) return;

    closeCertPreview();

    const rect = card.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'cert-preview';
    el.innerHTML = fullCertHTML(c, count);
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top - 10}px`;

    document.body.appendChild(el);
    certPreviewEl = el;

    requestAnimationFrame(() => el.classList.add('is-open'));
  }

  function bindCertPreview() {
    const list = $('#holdingList');
    if (!list) return;

    let currentCard = null;

    list.addEventListener('mouseover', (e) => {
      const card = e.target.closest('.stock-card');
      if (!card || card === currentCard) return;
      currentCard = card;
      openCertPreview(card);
    });

    list.addEventListener('mouseleave', () => {
      currentCard = null;
      closeCertPreview();
    });

    window.addEventListener('scroll', closeCertPreview, true);
    window.addEventListener('resize', closeCertPreview);
  }

  /* ---------------------------------------------------------- 渲染：席位 */

  /**
   * 当前玩家坐在下方操作区，其余玩家顺时针就座。
   * 顺序：下（当前）→ 左 → 对面 → 右。
   * 窄屏时左右侧栏放不下，全部排到对面。
   */
  function seatZones(count) {
    if (count <= 0) return [];
    if (window.innerWidth < RAIL_BREAKPOINT) return new Array(count).fill('top');
    if (count === 1) return ['top'];
    if (count === 2) return ['left', 'right'];

    const tops = count - 2;
    const zones = ['left'];
    for (let i = 0; i < tops; i++) zones.push('top');
    zones.push('right');
    return zones;
  }

  /**
   * 座位：这里算「每个座位该长什么样」（包括刚抽到牌的高亮），
   * 具体怎么拼 HTML 在 js/board-view-seats.js。
   *
   * 注意：以前 seatHTML 在渲染时顺手把 lastSeatHand 改掉，
   * 现在这一步留在这里，渲染模块保持无副作用。
   */
  function buildSeatView(index) {
    const p = state.players[index];
    const open = state.openInfo;

    const handCount = (state.hands[index] || []).length;
    const prevCount = state.lastSeatHand[index];
    const justDrew = prevCount !== undefined && handCount > prevCount;
    state.lastSeatHand[index] = handCount;

    const held = COMPANIES.filter((c) => p.stocks && p.stocks[c.id]);
    const holdings = !open
      ? null
      : held.map((c) => ({ mark: c.mark, color: c.color, name: c.name, count: p.stocks[c.id] }));

    const running = index === state.current && state.startedAt && !state.over && !state.paused;

    return {
      index,
      name: p.name,
      color: p.color,
      isHuman: isHuman(index),
      isCurrent: index === state.current && !state.over,
      showProgress: !!running,
      progressPercent: running ? currentRatio() * 100 : 0,
      handCount,
      slots: Math.max(HAND_SIZE, handCount),
      justDrew,
      cashText: open ? '$' + p.cash.toLocaleString('en-US') : '资金隐藏',
      cashHidden: !open,
      holdings,
    };
  }

  function renderSeats() {
    const n = state.players.length;
    if (!n) return;

    // 座位跟着「你」排：你坐下方，其余角色顺时针围过来；AI 行动时座位不动
    const others = [];
    for (let i = 1; i < n; i++) others.push((state.viewer + i) % n);

    const zones = seatZones(others.length);
    const buckets = { top: [], left: [], right: [] };
    others.forEach((idx, k) => { buckets[zones[k]].push(idx); });

    const seats = {};
    state.players.forEach((p, i) => { seats[i] = buildSeatView(i); });

    window.BoardViewSeats.render({ buckets, seats });
  }





  /** 阶段显示器：名字跟着玩家颜色，滑块滑到当前阶段 */
  function renderPhaseTrack() {
    const who = $('#phaseWho');
    const slider = $('#phaseSlider');
    const steps = $('#phaseSteps');
    if (!who || !slider || !steps) return;

    const p = state.players[state.current];
    const color = p ? p.color : '#d4b062';

    who.textContent = state.over ? '对局结束' : (p ? p.name : '—');
    who.style.color = color;

    const order = ['place', 'buy', 'draw'];
    const idx = state.over ? -1 : order.indexOf(state.phase);
    const safeIdx = idx < 0 ? 0 : idx;

    // 用 left 过渡实现「滑动」，阶段变化时不会消失再出现
    slider.style.left = (safeIdx * (100 / 3)) + '%';
    slider.style.background = color;
    slider.style.boxShadow = '0 0 14px ' + color;
    slider.style.opacity = state.over ? '0' : '1';

    steps.querySelectorAll('.phase-step').forEach((el, i) => {
      const on = i === safeIdx && !state.over;
      el.classList.toggle('is-on', on);
      el.style.color = on ? '#0d1116' : '';
    });
  }

    /* ---------------------------------------------------------- 渲染：操作区 */

  /**
   * 底部操作区：这里决定「显示什么、按钮能不能点」，
   * 具体写 DOM 在 js/board-view-tray.js。
   */
  function renderTray() {
    const n = state.players.length;
    if (!n) return;

    const p = state.players[state.viewer];
    const mine = !state.over && state.current === state.viewer && isHuman(state.current);

    // 购买按钮：还剩几张可买
    const left = 3 - state.bought;
    const buyDisabled = state.over || !isHuman(state.current) || state.phase !== 'buy' || left <= 0;
    const buyText = left > 0 ? `购买股票（${left}）` : '已买满 3 张';

    // 结束按钮：文案随阶段变化
    let endText;
    let endDisabled;
    if (state.over) { endText = '对局已结束'; endDisabled = true; }
    else if (!isHuman(state.current)) { endText = '等待 AI…'; endDisabled = true; }
    else if (state.phase === 'place') { endText = '结束回合'; endDisabled = true; }
    else if (state.phase === 'buy') { endText = '结束购买'; endDisabled = false; }
    else { endText = '补充板块中…'; endDisabled = true; }

    // 持股：微缩股票卡，悬停放大成完整证书
    const held = COMPANIES.filter((c) => p.stocks && p.stocks[c.id]);
    const holdingsHTML = held.length
      ? held.map((c) => miniCardHTML(c, p.stocks[c.id])).join('')
      : '<span class="hold-empty">还没有持股</span>';
    const total = held.reduce((sum, c) => sum + p.stocks[c.id], 0);

    // 重绘会换掉 DOM，悬停中的证书先收起来
    closeCertPreview();

    // 阶段显示器：玩家名 + 三格 + 滑动指示条
    renderPhaseTrack();

    // 本局现金最低值：铁公鸡要求「始终没低于 6000」
    state.minCash = Math.min(
      state.minCash === undefined || state.minCash === null ? p.cash : state.minCash,
      p.cash
    );

    window.BoardViewTray.render({
      avatarIndex: state.viewer,
      avatarColor: p.color,
      name: p.name,
      cashText: '$' + p.cash.toLocaleString('en-US'),
      roundNo: state.round,
      highlight: mine,
      buy: { text: buyText, disabled: buyDisabled },
      end: { text: endText, disabled: endDisabled },
      holdingsHTML,
      holdingsHint: total ? `共 ${total} 张` : '',
    });
  }

  /* ---------------------------------------------------------- 渲染：手牌 */

  /**
   * 手牌区：这里只负责把 state 翻译成一份视图对象，
   * 具体怎么画在 js/board-view-hand.js。
   */
  function renderHand() {
    // 手牌区永远显示「你的」手牌，不会因为 AI 行动而换成 AI 的牌
    const hand = state.hands[state.viewer] || [];
    const target = state.target;
    const myTurn = isHuman(state.current);

    /*
     * 弃牌按钮始终显示，只有「选中了一块放不下去的牌」时才可用。
     * 每回合只能用一次，用过就变灰。
     */
    const canDiscard = myTurn
      && state.phase === 'place'
      && !state.over
      && !state.discardedThisTurn
      && target && !target.legal;

    // 手牌比上次多了一张 → 那一张播「刚拿到」的动画
    state.lastHandLen = state.lastHandLen || [];
    const prevLen = state.lastHandLen[state.viewer];
    const grew = prevLen !== undefined && hand.length > prevLen;
    state.lastHandLen[state.viewer] = hand.length;
    const newIndex = grew ? hand.length - 1 : -1;

    window.BoardViewHand.render({
      tiles: hand.map(([c, r], idx) => ({
        label: coordLabel(c, r),
        selected: idx === state.selected,
        isNew: idx === newIndex,
      })),
      lockHand: state.phase !== 'place' || state.over || !myTurn,
      slots: handSlotCount(),
      hasSelection: state.selected >= 0,
      deckLeft: state.deck.length,
      discard: {
        disabled: !canDiscard,
        title: state.discardedThisTurn
          ? '本回合已经弃过牌了'
          : (canDiscard ? '弃掉选中的这块（移出本局）' : '先选一块放不下去的牌'),
      },
    });
  }

  /** 回合流程卡（对应实体配件） */
  function showFlow() {
    if (!window.Acquire) return;

    window.Acquire.openModal({
      title: '回合流程',
      subtitle: '在你的回合中，依次执行以下三个行动',
      body: `
        <ol class="flow-steps">
          <li>
            <span class="flow-num">1</span>
            <span class="flow-text">
              <b>放置建筑板块</b>
              <em>把一块建筑板块放到棋盘上它对应的格子里</em>
            </span>
          </li>
          <li>
            <span class="flow-num">2</span>
            <span class="flow-text">
              <b>购买股票</b>
              <em>至多买 3 张任意场上活跃连锁酒店的股票，可以不买</em>
            </span>
          </li>
          <li>
            <span class="flow-num">3</span>
            <span class="flow-text">
              <b>补充手牌</b>
              <em>从盲抽袋中抽一块新的建筑板块，手牌补回 6 块</em>
            </span>
          </li>
        </ol>
        <p class="flow-note">板块与股票的购买顺序不可颠倒；并购结算全部完成后才能进入第 2 步。</p>
      `,
      actions: [{ label: '知道了', className: 'btn--gold' }],
    });
  }

  function showReference() {
    if (!window.Acquire) return;

    const tycoon = state.mode === 'tycoon';

    // 表体：与实体卡一致，三列规模并列（对应三档价位），右侧是股价与分红
    const rows = PRICE_LADDER.map((price, step) => {
      const sizeCols = [0, 1, 2].map((back) => {
        const s = step - back;
        return `<td class="size">${s >= 0 ? STEP_LABELS[s] : '—'}</td>`;
      }).join('');

      const first = price * 10;
      const second = tycoon ? TYCOON_PAYOUT.second[step] : price * 5;
      const thirdCell = tycoon
        ? `<td class="pay3">$${TYCOON_PAYOUT.third[step].toLocaleString('en-US')}</td>`
        : '';

      return `
        <tr class="${step >= 5 ? 'is-safe' : ''}">
          ${sizeCols}
          <td class="price">$${price.toLocaleString('en-US')}</td>
          <td class="pay1">$${first.toLocaleString('en-US')}</td>
          <td class="pay2">$${second.toLocaleString('en-US')}</td>
          ${thirdCell}
        </tr>`;
    }).join('');

    // 表头：三列规模上方直接标出属于该档位的公司（与实体卡一致）
    const tierCols = [0, 1, 2].map((tier) => {
      const logos = COMPANIES.filter((c) => c.tier === tier)
        .map((c) => `<span class="ref-logo" style="--c:${c.color}" title="${c.name}">${c.mark}</span>`)
        .join('');
      return `<th class="size logo-cell"><div class="col-logos">${logos}</div></th>`;
    }).join('');

    window.Acquire.openModal({
      title: '股东信息卡',
      subtitle: `${tycoon ? '大亨模式' : '经典模式'} · 股价与股东分红`,
      body: `
        <table class="data ref">
          <thead>
            <tr class="logo-row">
              ${tierCols}
              <th colspan="${tycoon ? 4 : 3}" class="logo-note">↑ 这三列分别是小 / 中 / 大规模公司的规模</th>
            </tr>
            <tr>
              <th class="size">规模</th>
              <th class="size">规模</th>
              <th class="size">规模</th>
              <th>股价</th>
              <th>第一大股东</th>
              <th>第二大股东</th>
              ${tycoon ? '<th>第三大股东</th>' : ''}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p>同一规模下，档位越高价格越高：中等规模相当于规模 +1 档，大规模相当于 +2 档。
        所以中/大规模公司会在更靠下的一列里找到自己的规模。</p>
        <p>金底行表示公司已达到 <strong>11 块</strong>安全规模，不可被吞并。</p>
        ${tycoon
          ? '<p style="color:#74808f">第一大股东 = 股价 × 10；第二、第三大股东为卡面固定金额，不用倍数推算。</p>'
          : '<p style="color:#74808f">第一大股东 = 股价 × 10，第二大股东 = 股价 × 5，第三名及以下无分红。</p>'}
      `,
      actions: [{ label: '关闭', className: 'btn--ghost' }],
    });
  }



  /* -------------------------------------------------------------- 总渲染 */

  function render() {
    if (state.watch) updateWatchBar();
    state.target = computeTarget();
    const sizes = computeSizes();
    renderBoard(sizes);
    renderCompanies(sizes);
    renderSeats();
    renderTray();
    renderHand();

    // render 重建了所有格子节点，正在播的扫光要按剩余进度贴回去，
    // 否则「快速结束回合」这类操作会把动画打断
    window.Sweep.reattach();
  }

  /**
   * 手牌飞到棋盘上的动画。
   * fromRect / toRect 都是 getBoundingClientRect 的结果。
   *
   * 两种情况的飞行牌都是标准手牌尺寸，永远不会拉长变形：
   *   grow=false（自己落子）：从手牌原位置整张飞过去
   *   grow=true（AI 落子）  ：从它手牌的位置起飞，飞行途中由小变大
   * 动画期间目标格先隐藏，落地后再显形，避免「凭空出现」。
   */


  function flyTile(fromRect, toRect, text, done, grow) {
    const reduced = document.body.classList.contains('no-motion');

    if (reduced || !fromRect || !toRect) {
      if (done) done();
      return;
    }

    // AI 的起点是整张席位卡，不能拿它的宽高当牌的大小，统一按手牌尺寸来
    const side = tileSize();
    const w = grow ? side : fromRect.width;
    const h = grow ? side : fromRect.height;

    // 起点：让飞行牌居中盖在来源上（席位卡就取它的中心）
    const sx = grow ? fromRect.left + fromRect.width / 2 - w / 2 : fromRect.left;
    const sy = grow ? fromRect.top + fromRect.height / 2 - h / 2 : fromRect.top;

    const ghost = document.createElement('div');
    ghost.className = 'fly-tile';
    ghost.textContent = text;
    ghost.style.left = `${sx}px`;
    ghost.style.top = `${sy}px`;
    ghost.style.width = `${w}px`;
    ghost.style.height = `${h}px`;
    document.body.appendChild(ghost);

    // 中心到中心的位移，保证落点正对格子中心
    const dx = (toRect.left + toRect.width / 2) - (sx + w / 2);
    const dy = (toRect.top + toRect.height / 2) - (sy + h / 2);

    // 等比缩放：取宽高方向里较小的比例，绝不拉伸
    const landScale = Math.min(toRect.width / w, toRect.height / h);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ghost.remove();
      if (done) done();
    };

    const frames = grow
      ? [
        // 从它的手牌那里冒出一点
        { transform: 'translate(0, 0) scale(0.42)', opacity: 0, offset: 0 },
        { transform: 'translate(0, 0) scale(0.42)', opacity: 1, offset: 0.12 },
        // 飞行途中逐渐放大到正常大小
        {
          transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(1)`,
          opacity: 1,
          offset: 0.68,
        },
        // 落到格子上
        { transform: `translate(${dx}px, ${dy}px) scale(${landScale})`, opacity: 1, offset: 1 },
      ]
      : [
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(${dx}px, ${dy}px) scale(${landScale})`, opacity: 1, offset: 1 },
      ];

    const anim = ghost.animate(frames, {
      duration: grow ? 600 : 440,
      easing: 'cubic-bezier(0.34, 0, 0.22, 1)',
      fill: 'forwards',
    });

    anim.onfinish = finish;
    setTimeout(finish, (grow ? 600 : 440) + 300);   // 兜底
  }

  /* ------------------------------------------------------------ 回合计时 */

  /**
   * 等待时长配置：短 / 中 / 长（秒）
   * 对应方案：放置板块 20/35/50，购买股票 20/35/50
   */
  const WAIT_STEPS = { short: 20, medium: 35, long: 50 };
  const GRACE_MS = 5000;          // 进度条走完后再给的宽限

  function waitSeconds() {
    return WAIT_STEPS[state.waitTime] || WAIT_STEPS.medium;
  }
  /* ------------------------------------------------------------ 回合计时 */
  /*
   * 计时的「状态」全部交给 TurnTimer（js/timer.js）。
   * 这里只做三件事：算 key、把 ratio 画到界面、超时后决定谁来收尾。
   */

  /** 当前窗口的标识：玩家 + 阶段 + 动作序号，任何一项变了都算新窗口 */
  function timerKeyNow() {
    return state.current + ':' + state.phase + ':' + (state.actionTick || 0);
  }

  function resetTurnTimer() {
    if (!window.TurnTimer) return;
    window.TurnTimer.reset(timerKeyNow(), waitSeconds());
    paintTurnTimer();
  }

  function currentRatio() {
    return window.TurnTimer ? window.TurnTimer.ratio() : 1;
  }

  function tickTurnTimer() {
    const el = $('#turnTimer');
    if (!el || !window.TurnTimer) return;

    // 弹窗开着 / 没开局 / 结束 → 暂停计时（时间不流逝）
    const shouldPause = state.over || !state.startedAt || modalOpen() || state.paused;
    if (shouldPause) window.TurnTimer.pause();
    else window.TurnTimer.resume();

    const st = window.TurnTimer.tick(timerKeyNow(), waitSeconds());

    if (st.justExpired && isHuman(state.current)) sfx('error');

    if (st.justOver) {
      if (isHuman(state.current)) autoPlayTurn();
      return;
    }

    paintTurnTimer(st);
  }

  function paintTurnTimer(st) {
    const wrap = $('#turnTimer');
    const fill = $('#turnTimerFill');
    const text = $('#turnTimerText');
    if (!wrap || !fill) return;

    const s = st || (window.TurnTimer ? window.TurnTimer.status() : { ratio: 1, left: 0, graceLeft: 0 });

    /*
     * 底部这条只表示「你正在看的人在行动」。
     *
     * 以前这里还额外要求 isHuman(current)，等于「人一套、AI 一套」：
     * 观战时看的是 AI，就永远不显示。到底谁在行动不重要，
     * 重要的是「是不是当前视角的那个人」。
     */
    const active = state.players.length
      && !state.over
      && state.startedAt
      && !state.paused
      && !modalOpen()
      && state.current === state.viewer;

    wrap.hidden = !active;

    // 唯一数据源：座位条和底部条永远同一个比例
    document.querySelectorAll('.seat-progress i').forEach((b) => {
      b.style.width = (s.ratio * 100) + '%';
    });

    if (!active) return;

    fill.style.width = (s.ratio * 100) + '%';
    fill.classList.toggle('is-over', s.left <= 0);
    fill.classList.toggle('is-warn', s.left > 0 && s.ratio < 0.3);

    const who = state.players[state.current].name;
    if (s.left > 0) {
      text.textContent = who + ' · 剩余 ' + Math.ceil(s.left / 1000) + ' 秒';
    } else {
      text.textContent = '超时！' + Math.ceil(s.graceLeft / 1000) + ' 秒后自动代打';
    }
  }

  /** 对局时长 HH:MM:SS */
  function updateClock() {
    const el = $('#gameClock');
    if (!el) return;
    if (!state.startedAt) { el.textContent = '00:00:00'; return; }

    // 结束后用结束时刻算，计时器就停在那里
    const end = state.endedAt || Date.now();
    const sec = Math.max(0, Math.floor((end - state.startedAt) / 1000));
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    el.textContent = h + ':' + m + ':' + s;
  }

  /** 超时代打：放置阶段随机放一块，购买阶段直接结束 */
  function autoPlayTurn() {
    if (state.over || !isHuman(state.current)) return;
    if (modalOpen()) { resetTurnTimer(); return; }

    // 「你们怎么不动啊？」：这一回合是系统替你打的
    if (window.Career) window.Career.note('autoPlay', {});

    if (state.phase === 'place') {
      const hand = state.hands[state.current] || [];
      const legal = hand
        .map(([c, r], i) => ({ c, r, i, a: window.AcquireEngine.analyzePlacement(state.game, c, r) }))
        .filter((t) => t.a.valid);

      if (!legal.length) {
        // 没有能放的牌：这一手不落子，直接进入购买阶段（手牌保留）
        toast('超时：没有能放的牌，这一手跳过');
        state.phase = 'buy';
        state.actionTick = (state.actionTick || 0) + 1;
        resetTurnTimer();
        render();
        return;
      }

      // 走和玩家一模一样的点击路径，动画与结算都复用
      const pick = legal[Math.floor(Math.random() * legal.length)];
      toast('超时，系统替你随机放了一块');

      const tileEl = document.querySelector('.hand-tile[data-index="' + pick.i + '"]');
      if (tileEl) tileEl.click();

      setTimeout(function () {
        const cellEl = cellEls[pick.r * COLS + pick.c];
        if (cellEl) cellEl.click();
      }, 220);
      return;
    }

    if (state.phase === 'buy') {
      toast('超时，系统替你结束了购买');
      enterDrawPhase();
    }
  }
  /* ------------------------------------------------------------ 放置逻辑 */

  /**
   * 选中手牌后，算出这块牌该放在哪、能不能放。
   * 每块建筑板块正面印着坐标，只能放到那个格子。
   */
  function computeTarget() {
    if (state.phase !== 'place' || state.over || !isHuman(state.current)) return null;

    const hand = state.hands[state.current] || [];
    const tile = hand[state.selected];
    if (!tile) return null;

    const [c, r] = tile;
    const analysis = window.AcquireEngine.analyzePlacement(state.game, c, r);
    return { c, r, legal: analysis.valid, analysis };
  }

  /** 落子。返回引擎给出的分析结果，交给调用方决定后续交互。 */
  /**
   * 落子。返回里带一份「哪些格子归属变了」的清单 ——
   * 表现层只认这份清单，不去猜「这次是放置还是扩张还是并购」。
   */
  function placeAt(c, r) {
    const before = window.Sweep.snapshot();
    const result = window.AcquireEngine.applyPlacement(state.game, c, r);
    if (!result.ok) return { ok: false, reason: result.reason };

    if (window.BattleLog && state.players[state.current]) {
      const after = state.game.board[cellKey(c, r)];
      const owner = after ? companyName(after) : (result.analysis.type === 'found' ? '新公司' : '零散板块');
      window.BattleLog.add(state.players[state.current].name);
      window.BattleLog.add('[放置] ' + coordLabel(c, r) + '→' + owner);
    }

    return {
      ok: true,
      analysis: result.analysis,
      c,
      r,
      changed: window.Sweep.diff(before),
    };
  }

  /**
   * 全局共用的牌堆。
   * 108 块地块只有一份：在某人手里、已放到棋盘上，就不会再出现在牌堆里，
   * 所以手牌永远不会是一块已经放过的坐标。
   */
  function rebuildDeck() {
    const used = new Set(Object.keys(state.game.board));
    state.hands.forEach((hand) => {
      (hand || []).forEach(([c, r]) => used.add(cellKey(c, r)));
    });

    const deck = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = cellKey(c, r);
        if (!used.has(k)) deck.push([c, r]);
      }
    }

    // 洗牌
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }

    state.deck = deck;
  }

  /** 从牌堆顶部摸一块；摸完返回 null */
  function drawFromDeck() {
    if (!state.deck || !state.deck.length) return null;
    return state.deck.pop();
  }

  function dealHand() {
    const hand = [];
    for (let i = 0; i < HAND_SIZE; i++) {
      const tile = drawFromDeck();
      if (tile) hand.push(tile);
    }
    return hand;
  }

  /* -------------------------------------------------------------- 开局 */

  /** 真正的开局：空棋盘、满牌堆、每人 6 块、没有股票 */
  function newGameLayout() {
    state.game.board = Object.create(null);
    state.game.founded = Object.create(null);
    state.selected = -1;
    state.target = null;
    state.shares = {};
    state.lastSeatHand = [];

    state.hands = state.players.map(() => []);
    rebuildDeck();
    state.players.forEach((p, i) => { state.hands[i] = dealHand(); });

    render();
  }
  /** 公司上市后股票池初始化：每家 25 张 */
  function syncShares() {
    state.shares = state.shares || {};
    const sizes = computeSizes();
    COMPANIES.forEach((c) => {
      if (sizes[c.id] > 0 && state.shares[c.id] === undefined) {
        state.shares[c.id] = 25;
      }
      if (!(sizes[c.id] > 0)) delete state.shares[c.id];
    });
  }


  /** 落子后给出结果提示 */
  function reportPlacement(a) {
    if (!a) return;
    if (a.type === 'expand') {
      const gain = a.sizeGain || 1;
      const extra = gain > 1 ? `（新块 + ${gain - 1} 块零散板块）` : '';
      toast(`扩张 ${companyName(a.companyId)}，规模 ${a.size + gain} 块${extra}`);
    } else if (a.type === 'found') {
      toast(a.canFound ? '可以在这里创立新公司' : '7 家已满，这块只是连起了零散板块');
    } else {
      toast('孤立放置');
    }
  }

  /* -------------------------------------------------------- 创立公司选择 */

  function showFoundModal(c, r) {
    if (!window.Acquire) return;

    const free = COMPANIES.filter((co) => !state.game.founded[co.id]);
    if (!free.length) { toast('7 家公司都已上市，无法再创立'); return; }

    // 列出全部 7 家，已上市的变暗且点不动
    const cards = COMPANIES.map((co) => {
      const ok = !state.game.founded[co.id];
      return `
      <button class="found-card${ok ? '' : ' is-locked'}" data-id="${co.id}" style="--c:${co.color}" ${ok ? '' : 'disabled'}>
        <span class="found-badge">${co.mark}</span>
        <span class="found-name">${co.name}</span>
        <span class="found-tier">${ok ? TIER_NAMES[co.tier] + '规模' : '已上市'}</span>
      </button>`;
    }).join('');

    window.Acquire.openModal({
      title: '创立连锁酒店',
      subtitle: `把 ${coordLabel(c, r)} 这片板块组交给哪家公司上市？创业者免费获得 1 张创始人股票`,
      body: `<div class="found-grid">${cards}</div>`,
      // 必须选一家或「不创立」才能继续：无 X，有缩放按钮，点遮罩=点缩放
      collapsible: true,
      actions: [{
        label: '不创立',
        className: 'btn--ghost',
        onClick: () => {
          render();
          resolveTurn();
        },
      }],
    });

    const grid = document.getElementById('foundGrid') || document.querySelector('.found-grid');
    if (!grid) return;

    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.found-card');
      if (!btn) return;
      foundWith(btn.dataset.id, c, r);
    });
  }

  /**
   * 公司（重新）上市时初始化股票池。
   * 关键：可能有玩家在它上次退市时选择了「保留」，那些股票还在手里，
   * 必须从 25 张里扣掉，否则总数会超过 25。
   */
  function initSharePool(companyId, founderStock) {
    const held = state.players.reduce((n, p) => n + (p.stocks[companyId] || 0), 0);
    state.shares[companyId] = Math.max(0, 25 - held - founderStock);
    return held;
  }

  function foundWith(companyId, c, r) {
    // 创立会把这一团零散板块一起变成公司色，它们都属于「归属变化」
    const before = window.Sweep.snapshot();
    const res = window.AcquireEngine.foundCompany(state.game, companyId, c, r);
    if (!res.ok) { toast(res.reason); return; }

    /*
     * 创业者奖励：股份池还有股票就拿 1 张创始人股票；
     * 25 张已全部被持有则改为等值现金（规则书 §六④）。
     */
    const kept = state.players.reduce((n, pl) => n + (pl.stocks[companyId] || 0), 0);
    const p = state.players[state.current];
    const reward = window.Selectors.founderReward(kept, 25, priceOf(res.size, companyId));

    initSharePool(companyId, reward.stock);
    if (reward.stock) p.stocks[companyId] = (p.stocks[companyId] || 0) + reward.stock;
    else if (reward.cash) p.cash += reward.cash;

    if (window.Acquire) window.Acquire.closeModal();

    render();
    window.Sweep.queue(window.Sweep.diff(before));

    state.roundEvents = state.roundEvents || [];
    state.roundEvents.push('found');

    // 生涯记账：只统计你亲手创立的公司
    if (window.Career && isHuman(state.current)) {
      window.Career.note('found', { companyId });
    }

    sfx('found');
    toast(companyName(companyId) + ' 上市，规模 ' + res.size + ' 块 · ' + (reward.stock ? '获得 1 张创始人股票' : ('股票已售罄，获得 $' + reward.cash + ' 现金')) + (kept > 0 ? ' · 场上还有 ' + kept + ' 张旧股票' : ''));
    resolveTurn();
  }

  /** 购买股票（每回合至多 3 张，可以不买） */
  function showBuyModal() {
    const p = state.players[state.current];
    if (!p || !window.Acquire) return;

    if (state.over) { warn('对局已经结束了'); return; }
    if (state.phase !== 'buy') { warn('先放置一块建筑板块'); return; }

    const remain = 3 - state.bought;
    if (remain <= 0) { warn('本回合已经买满 3 张'); return; }

    const sizes = computeSizes();

    const picked = Object.create(null);   // companyId -> 张数

    const body = `
      <div class="buy-head">
        <span class="buy-cash">现金 <b id="buyCash">${p.cash.toLocaleString('en-US')}</b></span>
        <span>本回合还可买 <b>${remain} 张</b></span>
      </div>
      <div class="buy-list" id="buyList"></div>
      <div class="buy-summary" id="buySummary"></div>
    `;

    window.Acquire.openModal({
      title: '购买股票',
      subtitle: `${p.name} · 从场上仍然营业的公司买入`,
      body,
      actions: [
        { label: '不买了', className: 'btn--ghost' },
        {
          label: '确认购买',
          className: 'btn--gold',
          onClick: () => confirmBuy(picked, remain),
        },
      ],
    });

    // 弹窗内容打开后再绑定步进器
    const list = document.getElementById('buyList');
    if (!list) return;

    function paint() {
      const total = Object.values(picked).reduce((a, b) => a + b, 0);
      const cost = Object.keys(picked).reduce((sum, id) => {
        return sum + picked[id] * (priceOf(sizes[id], id) || 0);
      }, 0);

      list.innerHTML = COMPANIES.map((c) => {
        const n = picked[c.id] || 0;
        const size = sizes[c.id] || 0;
        const price = priceOf(size, c.id);
        const owned = p.stocks[c.id] || 0;
        const left = state.shares[c.id] || 0;
        // 未上市 / 售罄 / 没有价格 → 不可购买：条目变暗，按钮禁用
        const canBuy = size >= 2 && left > 0 && price > 0;
        const why = canBuy ? '' : (size < 2 ? '尚未上市' : '股票已售罄');

        return `
          <div class="buy-row${canBuy ? '' : ' is-locked'}" style="--c:${c.color}">
            <span class="buy-badge">${c.mark}</span>
            <span class="buy-name">${c.name}</span>
            <span class="buy-meta">${canBuy
              ? `规模 ${size} · 持有 ${owned} · 余 ${left}`
              : why}</span>
            <span class="buy-price">${canBuy ? `$${price}` : '—'}</span>
            <span class="stepper">
              <button data-id="${c.id}" data-d="-1" ${!canBuy || n === 0 ? 'disabled' : ''}>−</button>
              <b>${n}</b>
              <button data-id="${c.id}" data-d="1" ${!canBuy || total >= remain || n >= left || cost + price > p.cash ? 'disabled' : ''}>+</button>
            </span>
          </div>`;
      }).join('');

      const sum = document.getElementById('buySummary');
      if (sum) {
        sum.textContent = total
          ? `已选 ${total} 张，合计 $${cost.toLocaleString('en-US')}`
          : '还没有选择股票';
      }
    }

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn || btn.disabled) return;

      const id = btn.dataset.id;
      const d = Number(btn.dataset.d);
      const next = (picked[id] || 0) + d;

      if (next <= 0) delete picked[id];
      else picked[id] = next;

      paint();
    });

    paint();
  }

  /** 确认购买：扣钱、加股、减股票池 */
  function confirmBuy(picked, remain) {
    const p = state.players[state.current];
    const sizes = computeSizes();

    let total = 0;
    let cost = 0;

    Object.keys(picked).forEach((id) => {
      const n = picked[id];
      const price = priceOf(sizes[id], id) || 0;
      total += n;
      cost += n * price;
      p.stocks[id] = (p.stocks[id] || 0) + n;
      state.shares[id] = Math.max(0, (state.shares[id] || 0) - n);
    });

    if (!total) return;

    p.cash -= cost;
    state.bought += total;

    if (window.BattleLog) {
      window.BattleLog.add(p.name + ' 买入 ' + Object.keys(picked)
        .map((id) => picked[id] + ' 张 ' + companyName(id)).join('、'));
    }

    sfx('cash');
    render();
    toast(`买入 ${total} 张股票，花费 $${cost.toLocaleString('en-US')}`);
  }

  /* ------------------------------------------------------------ 并购结算 */

  let merge = null;

  /** 按持股数排名并分组（并列放同一组） */
  /**
   * 按股数分组（同股数一组），从大到小。
   * 计算在 js/selectors.js 里，这里只是把 state 拆成它要的参数。
   */
  function rankHoldersLocal(companyId) {
    return window.Selectors.groupHolders(state.players, companyId);
  }

  /** 从触发板块的玩家开始，顺时针列出持股者 */


  /**
   * 并购向导换步骤。
   * 注意：第一次必须用「打开但不带 action」的方式，走我们自己绑的事件，
   * 否则主弹窗那套「onClick 之后自动关闭」会把下一步刚开的弹窗一起关掉。
   */
  function mergeModal(title, subtitle, body, actions) {
    const overlayEl = document.getElementById('overlay');
    const isOpen = overlayEl && !overlayEl.hidden;

    if (!isOpen) {
      window.Acquire.openModal({ title, subtitle, body, actions: [], collapsible: true });
    }

    document.getElementById('modalTitle').textContent = title;
    // 收纳成书签时显示的是另一个元素，这里必须一起改，否则会一直显示第一次的标题
    const barTitle = document.getElementById('modalBarTitle');
    if (barTitle) barTitle.textContent = title;
    document.getElementById('modalBody').innerHTML =
      (subtitle ? `<p class="modal-sub">${subtitle}</p>` : '') + body;

    // 股票处置内容宽，单独放宽弹窗
    const modalEl = document.querySelector('#overlay .modal');
    if (modalEl) modalEl.classList.toggle('is-wide', String(title).indexOf('股票处置') >= 0);

    const bar = document.getElementById('modalActions');
    bar.innerHTML = actions
      .map((a, i) => `<button class="btn ${a.className || 'btn--ghost'}" data-i="${i}">${a.label}</button>`)
      .join('');

    bar.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', function once() {
        // 先自毁：连点、重复触发都不会执行第二次
        btn.removeEventListener('click', once);
        btn.disabled = true;
        bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });

        const act = actions[Number(btn.dataset.i)];
        if (!act || !act.onClick) return;

        try {
          act.onClick();
        } catch (err) {
          console.error('[merge step]', err);
          // 并购流程出错也必须能继续/退出，绝不允许把玩家锁在弹窗里
          try {
            if (typeof finishMerger === 'function') finishMerger();
          } catch (e2) {
            if (window.Acquire) window.Acquire.closeModal();
          }
          toast('并购结算出错，已跳过：' + (err.message || err));
        }
      });
    });
  }

  /**
   * 开始并购结算。
   * aiDriven=true 表示这一手是 AI 打出的：不再让玩家选存活方，
   * 但「股票逐张处置」这一步照样要给玩家（只要他持有被吞并公司的股票）。
   */
  function startMerger(result, aiDriven) {
    try {
      startMergerInner(result, aiDriven);
    } catch (err) {
      reportMergerFailure(result, aiDriven, err, 'startMerger');
    }
  }

  /**
   * 兜底结算：并购流程一旦出错，直接按最简单的方式收尾——
   * 逐个把败方并入存活方，然后继续回合。
   * 宁可结算简化，也绝不让对局卡死。
   */
  /**
   * 并购出错时的处理：**明确报错、停止回合**，不做任何静默修补。
   *
   * 为什么要这么写：
   * 之前的兜底会自动把败方并进去、跳过分红和股票处置，结果是
   * 「游戏没卡死，但局面被悄悄改错了」——真正的 bug 被藏起来，
   * 反而要花更多时间才找得到。
   *
   * 现在改成：把错误原样抛到台面上，停下这一手，由玩家决定怎么继续。
   */
  function reportMergerFailure(result, aiDriven, err, kind) {
    const msg = (err && (err.message || err)) || '未知错误';
    const where = (err && err.stack) ? String(err.stack).split('\n').slice(0, 3).join('\n') : '';

    // 先把状态收拾干净，避免半结算的棋盘影响后续
    if (window.Merger) window.Merger.abort();
    merge = null;
    if (window.Acquire) {
      if (window.Acquire.lockModal) window.Acquire.lockModal(false);
      window.Acquire.closeModal();
    }

    console.error('[并购结算失败] ' + (kind || '') + '\n' + where);
    if (window.Career && window.Career.reportError) {
      try { window.Career.reportError(msg); } catch (e) { /* 忽略 */ }
    }

    if (!window.Acquire || !window.Acquire.openModal) return;

    window.Acquire.openModal({
      title: '并购结算出错',
      subtitle: '这一手已经停下，没有自动修补任何数据',
      body:
        '<p class="bug-line"><b>错误：</b>' + escapeHTML(msg) + '</p>'
        + (where ? '<pre class="bug-stack">' + escapeHTML(where) + '</pre>' : '')
        + '<p>你的选择：</p>'
        + '<ul class="bug-list">'
        + '<li><b>跳过并购</b>：把这一手当作没发生，回合交给下一位（局面可能不再符合规则）</li>'
        + '<li><b>返回主菜单</b>：放弃这一局，从头开始</li>'
        + '</ul>'
        + '<p class="bug-hint">如果你是开发者在调试：请把控制台里 <code>[并购结算失败]</code> 那段贴出来。</p>',
      actions: [
        {
          label: '跳过并购继续',
          className: 'btn--ghost',
          onClick: function () {
            // 跳过：不改棋盘、不发分红，只把回合推过去
            try {
              if (aiDriven) afterAiPlacement(state.current);
              else resolveTurn();
            } catch (e) {
              console.error('[skip merger]', e);
            }
          },
        },
        {
          label: '返回主菜单',
          className: 'btn--danger',
          onClick: function () {
            if (window.Acquire) window.Acquire.showScreen('menu');
          },
        },
      ],
    });
  }

  /** 极简 HTML 转义，只用于把错误信息显示到界面上 */
  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function startMergerInner(result, aiDriven) {
    if (window.BattleLog && result && result.analysis) {
      const comps = result.analysis.companies || [];
      const sizes = result.analysis.sizes || {};
      const maxSize = Math.max.apply(null, comps.map((id) => sizes[id] || 0));
      const surv = comps.filter((id) => (sizes[id] || 0) === maxSize);
      const loserIds = comps.filter((id) => surv.indexOf(id) < 0);
      if (surv.length === 1) {
        window.BattleLog.add('[触发并购] ' + companyName(surv[0])
          + '（' + (sizes[surv[0]] || 0) + '）吞并 '
          + loserIds.map((id) => companyName(id) + '（' + (sizes[id] || 0) + '）').join('、'));
      } else {
        window.BattleLog.add('[触发并购] 平局：' + comps.map(companyName).join(' / '));
      }
    }

    state.roundEvents = state.roundEvents || [];
    state.roundEvents.push('merge');
    const a = result.analysis;

    merge = {
      c: result.c,
      r: result.r,
      companies: a.companies.slice(),
      sizes: Object.assign({}, a.sizes),
      survivorId: a.tie ? null : a.largest[0],
      candidates: a.largest.slice(),
      tie: !!a.tie,
      absorb: (a.absorb || []).slice(),
      queue: [],
      index: 0,
      decisions: Object.create(null),
      aiDriven: !!aiDriven,
      aiIdx: aiDriven ? state.current : null,
    };

    sfx('merge');

    if (window.Career && isHuman(state.current)) {
      window.Career.note('trigger', { count: merge.companies.length });
    }

    // 整个向导期间锁住弹窗，防止中途关闭留下半结算的棋盘
    if (window.Acquire && window.Acquire.lockModal) window.Acquire.lockModal(true);

    /*
     * 流程控制交给 Merger 状态机（js/merger.js）。
     * 这里只提供「数据」和「怎么画」，不再自己维护 queue / index。
     */
    window.Merger.begin({
      survivors: merge.companies,
      survivorId: merge.tie ? null : merge.companies.reduce((best, id) =>
        (merge.sizes[id] || 0) > (merge.sizes[best] || 0) ? id : best, merge.companies[0]),
      sizes: merge.sizes,
      handlers: {
        onStage: function () { /* 由下面的阶段函数自己接管 */ },
        onFinish: null,          // finishMerger 自己调用 Merger.finish
        onToast: function (msg) { toast(msg); },
      },
    });

    if (!window.Merger.survivorId()) {
      if (merge.aiDriven) {
        const pick = window.AcquireAI
          ? window.AcquireAI.pickSurvivor(aiContext(state.current), a)
          : merge.candidates[0];
        window.Merger.chooseSurvivor(pick);
        merge.survivorId = pick;
        beginQueue();
      } else {
        stageSurvivor();
      }
    } else {
      merge.survivorId = window.Merger.survivorId();
      beginQueue();
    }

    // 看门狗统一由 merger.js 管理：等玩家确认时会自动停表，不会误报

  }
  /**
   * 无情背刺：并列裁决时，故意让「当前净资产第一的对手」损失最大的那一方存活。
   *
   * 判定方式：先算出每个候选存活方对应的「第一名会损失多少」，
   * 再看人类实际选的这一家，是不是那个让损失最大的选项。
   * 只要选了对对手最狠的方案，就算一次背刺 —— 不论出于什么动机。
   */
  function noteBackstab(chosenSurvivor) {
    if (!window.Career || !merge || !isHuman(state.current)) return;
    if (!merge.candidates || merge.candidates.length < 2) return;

    const priceOfCompany = (id) => priceOf(window.AcquireEngine.companySize(state.game, id), id) || 0;

    // 找出当前净资产第一的对手（不算自己）
    let topOpponent = -1;
    let topNet = -1;
    state.players.forEach((p, i) => {
      if (i === state.viewer) return;
      const net = window.Selectors
        ? window.Selectors.playerNetWorth(state.game.board, state.players, i, priceOf)
        : (p.cash || 0);
      if (net > topNet) { topNet = net; topOpponent = i; }
    });
    if (topOpponent < 0) return;

    const opp = state.players[topOpponent];
    const lossIf = (survivor) => merge.candidates.reduce((sum, id) => {
      if (id === survivor) return sum;
      return sum + (opp.stocks[id] || 0) * priceOfCompany(id);
    }, 0);

    const lossOf = {};
    merge.candidates.forEach((id) => { lossOf[id] = lossIf(id); });
    const maxLoss = Math.max.apply(null, merge.candidates.map((id) => lossOf[id]));

    if (maxLoss > 0 && lossOf[chosenSurvivor] === maxLoss) {
      window.Career.note('backstab', {});
    }
  }

  function stageSurvivor() {
    const cards = merge.candidates.map((id) => {
      const c = COMPANY_BY_ID[id];
      return `
        <button class="found-card" data-id="${id}" style="--c:${c.color}">
          <span class="found-badge">${c.mark}</span>
          <span class="found-name">${c.name}</span>
          <span class="found-tier">规模 ${merge.sizes[id]} 块</span>
        </button>`;
    }).join('');

    mergeModal(
      '并购结算',
      '规模并列，由打出触发板块的玩家决定谁存活',
      `<div class="found-grid">${cards}</div>`,
      []
    );

    const grid = document.querySelector('.found-grid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.found-card');
        if (!btn || btn.disabled || btn.classList.contains('is-locked')) return;

        // 先结算「背刺」判定（要用到选择前的数据）
        noteBackstab(btn.dataset.id);

        merge.survivorId = btn.dataset.id;
        // 必须告诉状态机，否则它还会把这家当成被吞并方处理一遍
        if (window.Merger) window.Merger.chooseSurvivor(btn.dataset.id);
        beginQueue();
      });
    }
  }

  function beginQueue() {
    // 队列由 Merger 维护，这里只拿「当前该处理哪一家」
    merge.survivorId = window.Merger.survivorId() || merge.survivorId;
    stageDividend();
  }

  function stageDividend() {
    const loserId = window.Merger.currentLoser();
    if (!loserId) { finishMerger(); return; }

    const size = window.AcquireEngine.companySize(state.game, loserId);
    const pay = payouts(size, loserId);

    // 规模小于 2 时没有价位档（实体规则里公司至少 2 块才成立）。
    // 与其崩在 spreadDividends 里读 null.first，不如给一句能看懂的话。
    if (!pay) {
      throw new Error('无法计算 ' + companyName(loserId) + ' 的分红：规模只有 ' + size + ' 块，小于成立所需的 2 块。棋盘数据可能已损坏。');
    }
    const groups = rankHoldersLocal(loserId);
    const dist = window.AcquireEngine.computeDividends(state.mode, groups, pay);

    // 不论谁触发的并购，分红界面都要走一遍确认

    // 名次文字：1 → 第一；2 → 第二、第三；…
    const ORD = ['第一', '第二', '第三', '第四', '第五'];
    /*
     * 表格里的「持股」必须是他真实持有多少股，与有没有分到钱无关。
     *
     * 所以不再用 spread.rows 拼表 —— 它只包含能拿钱的那几档，
     * 后面「有股票但没上榜」的人会被漏掉（以前这些人被塞进 0 张的行里）。
     *
     * 现在的做法：把所有持股人从大到小铺开，再把分到的钱贴上去。
     */
    const slots = state.mode === 'tycoon' ? 3 : 2;
    const paidBy = dist || Object.create(null);

    let rankPos = 0;
    const holderRows = [];

    groups.forEach((g) => {
      const from = rankPos;
      const to = rankPos + g.length - 1;
      rankPos += g.length;

      /*
       * 超出档位（经典 2 档 / 大亨 3 档）的人没有名次，也拿不到钱。
       * 名次列显示 — 即可，不要写成「第四大股东」——卡上根本没有这一档。
       */
      const overSlots = from >= slots;

      const label = overSlots
        ? '—'
        : (groups.length === 1 && g.length === 1)
          ? '大股东 + 最小股东'
          : (g.length === 1
            ? ORD[from] + '大股东'
            : ORD[from] + '~' + ORD[Math.min(to, ORD.length - 1)] + '大股东');

      const note = (!overSlots && g.length > 1)
        ? '（' + g.length + ' 人并列，占 ' + (to - from + 1) + ' 个名次）'
        : '';

      g.forEach((h) => {
        const amount = paidBy[h.player] || 0;
        holderRows.push(`
        <tr data-p="${h.player}">
          <td>${label + note}</td>
          <td>${state.players[h.player].name}</td>
          <td>${h.count} 张</td>
          <td class="pay1">${amount > 0 ? '$' + amount.toLocaleString('en-US') : '—'}</td>
          <td class="vote-cell">${voteBtnHTML(h.player)}</td>
        </tr>`);
      });
    });

    // 没持股的人排在最后，按座次（从当前玩家起顺时针）
    const holderSet = Object.create(null);
    groups.forEach((g) => g.forEach((h) => { holderSet[h.player] = true; }));

    const idleRows = [];
    for (let i = 0; i < state.players.length; i++) {
      const pi = (state.current + i) % state.players.length;
      if (holderSet[pi]) continue;
      idleRows.push(`
        <tr class="is-idle" data-p="${pi}">
          <td>—</td>
          <td>${state.players[pi].name}</td>
          <td>0 张</td>
          <td class="pay1">—</td>
          <td class="vote-cell">${voteBtnHTML(pi)}</td>
        </tr>`);
    }

    const rowsAll = holderRows.concat(idleRows).join('')
      || '<tr><td colspan="5">无人持股，不需要分红</td></tr>';

    const noHolder = Object.keys(dist).length === 0;
    const survivorSize = window.AcquireEngine.companySize(state.game, merge.survivorId);

    mergeModal(
      '并购结算 · 分红',
      `<span class="merge-pair">`
        + `<i class="mix-badge" style="--c:${COMPANY_BY_ID[merge.survivorId].color}">${COMPANY_BY_ID[merge.survivorId].mark}</i>`
        + `<b>${companyName(merge.survivorId)}</b>`
        + `<span class="merge-size">(${survivorSize} 块)</span>`
        + `<em>吞并</em>`
        + `<i class="mix-badge" style="--c:${COMPANY_BY_ID[loserId].color}">${COMPANY_BY_ID[loserId].mark}</i>`
        + `<b>${companyName(loserId)}</b>`
        + `<span class="merge-size">(${size} 块)</span>`
        + `<span class="merge-meta">· 股价 $${priceOf(size, loserId)}</span></span>`
        + `<br><span style="color:#74808f">${companyName(merge.survivorId)} 规模较大，自动存活`
        + `，${companyName(loserId)} 即将并入 ${companyName(merge.survivorId)}</span>`,
      `
        <table class="data">
          <thead><tr><th>名次</th><th>股东</th><th>持股</th><th>分红</th><th>确认</th></tr></thead>
          <tbody>${rowsAll}</tbody>
        </table>
        ${voteFooterHTML()}
        <p class="vote-hint">所有人确认后自动继续 —— 这一步只是核对，不分先后。</p>
      `,
      []
    );

    // 分红是「看」的环节：大家各自确认，不分先后
    beginVote({
      ordered: false,
      startIdx: state.current,
      onDone: function () {
        merge.paid = merge.paid || Object.create(null);
        const token = 'div:' + loserId;
        if (!merge.paid[token]) {
          merge.paid[token] = true;
          applyDividends(dist, loserId);
        }
        if (window.Merger) window.Merger.releaseWatchdog();
        stageStocks(loserId, size);
      },
    });
    if (window.Merger) window.Merger.holdWatchdog();
  }

  function applyDividends(dist, companyId) {
    Object.keys(dist).forEach((idx) => {
      state.players[Number(idx)].cash += dist[idx];
    });

    // 生涯记账：只统计你本人的分红
    if (window.Career && dist[state.viewer] && isHuman(state.viewer)) {
      const groups = companyId ? rankHoldersLocal(companyId) : [];
      window.Career.note('dividend', {
        amount: dist[state.viewer],
        solo: groups.length === 1,
      });

      /*
       * 极限卡位：你独占第一大股东，而第二名只比你少 1 张。
       * 只有 1 张的差距，说明这一档是从对手手里「卡」下来的。
       */
      /*
       * 大冤种：这次并购是你自己打的，但你的分红是全场最低（通常是 0）。
       * 只在「发起者是人类」时判定 —— AI 打出的并购与你无关。
       */
      if (merge && !merge.aiDriven) {
        const mine = dist[state.viewer] || 0;
        const all = Object.keys(dist).map((k) => dist[k]);
        const lowest = all.length ? Math.min.apply(null, all) : 0;
        if (mine <= lowest) window.Career.note('worstDividend', {});
      }

      const top = groups[0];
      const second = groups[1];
      if (top && second && top.length === 1 && top[0].player === state.viewer
        && second[0].count === top[0].count - 1) {
        window.Career.note('edge', {});
      }
    }
    if (window.BattleLog && Object.keys(dist).length) {
      window.BattleLog.add('[并购·分红] ' + Object.keys(dist)
        .map((k) => {
          const pl = state.players[Number(k)];
          return (pl ? pl.name : k) + ' +$' + dist[k];
        }).join('、'));
    }

    if (Object.keys(dist).length) sfx('cash');

    /*
     * 分红到账是「全体确认完、分红弹窗关闭」的那一瞬，
     * 所以这里必须整屏重绘：只刷 renderTray() 的话，只有*你自己*的现金会变，
     * AI 座位上的现金要等下一次 render()（股票处置弹窗打开）才更新 ——
     * 看起来就像「AI 的钱晚一步到账」。
     */
    render();
  }

  /**
   * 股票处置的图形引导：三种去向各一张卡片，用箭头把「2 张换 1 张」画出来。
   * 比一整段文字好读，也直接对应下面每一行的三个计数器。
   */
  /** 组装上下文，交给 StockUI 生成（界面代码见 js/stock-ui.js） */
  function stockGuideHTML(loserId, survivorId) {
    return window.StockUI.guideHTML({
      loser: COMPANY_BY_ID[loserId],
      survivor: COMPANY_BY_ID[survivorId],
      loserName: companyName(loserId),
      survivorName: companyName(survivorId),
      price: priceOf(window.AcquireEngine.companySize(state.game, loserId) || 2, loserId),
      pool: state.shares[survivorId] || 0,
    });
  }

/* ------------------------------------------------------------ 并购确认投票 */

/*
 * 并购的两个结算界面都用「逐个确认」的交互：
 *   - 分红：只是看，不分先后，所有人确认完就过
 *   - 股票处置：必须按顺序（发起者起顺时针），当前该谁确认谁才能点
 *
 * 共通规则：
 *   - 没有底部的关闭按钮，也不能点 X 关掉
 *   - AI 思考 1~2 秒后自己确认
 *   - 底下一排小圆点表示确认进度
 *   - 全部确认完 → 等 1 秒 → 自动关闭并进入下一步
 */

const AI_THINK_MS = () => 1000 + Math.random() * 1000;

/** 当前票的控制器（挂在 merge.vote 上） */
function voteCtl() {
  return merge && merge.vote ? merge.vote : null;
}

/**
 * cfg = {
 *   ordered: bool,      是否需要按顺序
 *   startIdx: number,   顺序起点（并购发起者）
 *   onDone: fn,         全部确认完、1 秒后调用
 * }
 */
function beginVote(cfg) {
  const n = state.players.length;
  const start = cfg.startIdx != null ? cfg.startIdx : state.current;

  const order = [];
  for (let k = 0; k < n; k++) order.push((start + k) % n);

  merge.vote = {
    ordered: !!cfg.ordered,
    beforeConfirm: cfg.beforeConfirm || null,
    order: order,
    ptr: 0,
    current: cfg.ordered ? order[0] : -1,
    confirmed: Object.create(null),
    scheduled: Object.create(null),
    count: 0,
    total: n,
    done: false,
    timers: [],
    onDone: cfg.onDone,
  };

  bindVoteClicks();
  hideModalChrome();
  refreshVoteUI();
  scheduleAiConfirms();
}

/** 这个玩家现在能不能点确认 */
function canConfirmVote(idx) {
  const v = voteCtl();
  if (!v || v.done) return false;
  if (v.confirmed[idx]) return false;
  if (!isHuman(idx)) return false;          // AI 由定时器自己确认
  if (v.ordered) return v.current === idx;   // 顺序模式：只能轮到自己
  return true;
}

function confirmVote(idx) {
  const v = voteCtl();
  if (!v || v.done) return;
  if (v.confirmed[idx]) return;
  if (v.ordered && v.current !== idx) return;

  // 确认前的钩子：AI 就是在这一刻才真正决定怎么处置股票
  if (typeof v.beforeConfirm === 'function') {
    try { v.beforeConfirm(idx); } catch (e) { console.error('[beforeConfirm]', e); }
  }

  v.confirmed[idx] = true;
  v.count += 1;
  sfx('click' in window ? 'ui' : 'ui');

  if (v.ordered) {
    // 轮到下一个还没确认的人
    v.ptr += 1;
    while (v.ptr < v.order.length && v.confirmed[v.order[v.ptr]]) v.ptr += 1;
    v.current = v.ptr < v.order.length ? v.order[v.ptr] : -1;
  }

  refreshVoteUI();
  scheduleAiConfirms();
  maybeFinishVote();
}

function scheduleAiConfirms() {
  const v = voteCtl();
  if (!v || v.done) return;

  if (v.ordered) {
    // 顺序模式：只有当前这个人需要 AI 确认
    const cur = v.current;
    if (cur == null || cur < 0) return;
    if (isHuman(cur) || v.confirmed[cur] || v.scheduled['c' + cur]) return;
    v.scheduled['c' + cur] = true;

    v.timers.push(setTimeout(function () {
      v.scheduled['c' + cur] = false;
      if (!merge || merge.vote !== v || v.done) return;
      confirmVote(cur);
    }, AI_THINK_MS()));
    return;
  }

  // 不分顺序：每个还没确认的 AI 各自排一次
  for (let i = 0; i < v.total; i++) {
    if (isHuman(i) || v.confirmed[i] || v.scheduled[i]) continue;
    v.scheduled[i] = true;

    v.timers.push(setTimeout(function () {
      v.scheduled[i] = false;
      if (!merge || merge.vote !== v || v.done) return;
      confirmVote(i);
    }, AI_THINK_MS()));
  }
}

function maybeFinishVote() {
  const v = voteCtl();
  if (!v || v.done) return;
  if (v.count < v.total) return;

  v.done = true;
  v.timers.forEach(clearTimeout);
  v.timers = [];

  // 全部确认完，等 1 秒再自动走
  v.timers.push(setTimeout(function () {
    if (!merge) return;
    const cb = v.onDone;
    merge.vote = null;
    if (typeof cb === 'function') cb();
  }, 1000));
}

/** 刷新按钮 / 高亮 / 圆点，不重建 DOM */
function refreshVoteUI() {
  const v = voteCtl();
  const body = document.getElementById('modalBody');
  if (!v || !body) return;

  body.querySelectorAll('.vote-btn').forEach(function (btn) {
    const i = Number(btn.dataset.confirm);
    const done = !!v.confirmed[i];
    btn.disabled = done || !canConfirmVote(i);
    btn.textContent = done ? '已确认' : (v.ordered && v.current !== i ? '等待' : '确认');
    btn.classList.toggle('is-done', done);
    btn.classList.toggle('is-waiting', !done && v.ordered && v.current !== i);
  });

  body.querySelectorAll('.vote-dot').forEach(function (dot) {
    const i = Number(dot.dataset.i);
    dot.classList.toggle('is-on', !!v.confirmed[i]);
    dot.classList.toggle('is-now', v.ordered && v.current === i);
    dot.style.setProperty('--p', state.players[i].color);
  });

  // 顺序模式下，当前该确认的那一行整体高亮
  body.querySelectorAll('[data-p]').forEach(function (row) {
    const i = Number(row.dataset.p);
    row.classList.toggle('is-voting', v.ordered && v.current === i && !v.confirmed[i]);
    row.classList.toggle('is-confirmed', !!v.confirmed[i]);
  });

  const label = body.querySelector('.vote-label');
  if (label) label.textContent = v.count + ' / ' + v.total + ' 已确认';
}

function bindVoteClicks() {
  const body = document.getElementById('modalBody');
  if (!body || body._voteBound) return;
  body._voteBound = true;

  body.addEventListener('click', function (e) {
    const btn = e.target.closest('.vote-btn');
    if (!btn) return;
    confirmVote(Number(btn.dataset.confirm));
  });
}

/** 并购界面不允许关：藏掉 X */
function hideModalChrome() {
  const close = document.getElementById('modalClose');
  if (close) close.style.visibility = 'hidden';
}

/** 底部投票条 */
function voteFooterHTML() {
  // 不依赖 vote 是否已建立：这个条是在弹窗内容里先渲染出来的
  const total = state.players.length;
  const dots = state.players.map(function (p, i) {
    return '<i class=\'vote-dot\' data-i=\'' + i + '\' style=\'--p:' + p.color + '\'></i>';
  }).join('');
  return '<div class=\'vote-bar\'>'
    + '<span class=\'vote-label\'>0 / ' + total + ' 已确认</span>'
    + '<span class=\'vote-dots\'>' + dots + '</span>'
    + '</div>';
}

/** 某一行的确认按钮 */
function voteBtnHTML(idx) {
  return '<button class="vote-btn" data-confirm="' + idx + '">确认</button>';
}

  /**
   * AI 的处置行：和玩家行完全同构的三格（套现 / 置换 / 保留），
   * 只是不能点，数字直接给结果。
   * dec 为 null 时显示占位，表示还在思考。
   */
  function aiStockRowHTML(h, dec, sellPrice, isAi) {
    return window.StockUI.aiRowHTML({
      player: state.players[h.player],
      count: h.count,
      index: h.player,
      dec: dec,
      sellPrice: sellPrice,
      voteBtn: voteBtnHTML(h.player),
      // 默认按 AI 行渲染；结算人类玩家时显式传 false
      isAi: isAi !== false,
    });
  }

    /**
   * 结算某一个玩家的股票处置。
   *
   * 关键点：这件事发生在「他点确认」的那一刻，而不是等所有人确认完。
   * 处置是有顺序的 —— 前一个人换走几张，后面的人能换的上限就要跟着变，
   * 否则会出现多人同时抢同一批股票（虚空股票）。
   *
   * 同一玩家只会结算一次（merge.results 里有没有他的记录）。
   */


  /** 把「存活方剩余股票 N 张」刷新到最新 */


    /**
   * 被吞并公司的股票处置：套现 / 2换1 / 保留，逐张独立选择。
   * 三者的数量关系：套现 = 持有 - 置换×2 - 保留
   * 所以只让玩家调「置换」和「保留」，套现自动跟着变。
   */
  /**
   * AI 的处置方案在「轮到它确认」的这一刻才算。
   *
   * 不能提前算：前一个人置换会改变剩余股票数，提前算出来的方案可能已经失效
   * （这就是之前「显示 0 组、实际换了 7 组」的根源之一）。
   */


  /**
   * 把一行的数字重新画一遍（玩家点 −/＋ 之后调用）。
   * 只改文字和按钮可用性，不重建 DOM，所以不会丢焦点、不会闪。
   */


  /**
   * 置换 / 保留 的上限钳制。
   * 置换：受持有数的一半、存活方股票池限制；
   * 保留：不能被置换占掉的份。
   * 直接改传入的 d，所以调用方拿到的就是合法值。
   */


  /** 套现张数 = 持有数 − 置换消耗 − 保留 */


  /** 点 −/＋ 之后改决策值，再重画 */


  /**
   * 人类持股行：套现 / 置换 / 保留 三格，带 −/＋ 按钮。
   * 从 stageStocks 里提出来的（提取方法），行为与原来逐字一致。
   */


  /** 没有这只股票的玩家：一行灰字 + 确认按钮 */


  /**
   * 置换 / 保留 的 −＋ 按钮是否可点。
   * 规则：置换每 +1 要吃掉 2 张股票，且不能超过存活方剩余股票数；
   *       保留每 +1 只占 1 张，但要把置换占掉的份排除在外。
   */




  /**
   * 收尾。
   * 股票在每个人「确认」的时候就已经结算过了（settleStockPlayer），
   * 这里只兜底处理那些没走到确认的玩家，然后写摘要。
   */

  /** 把败方板块并进存活公司，然后进入下一个 */
  function completeStep(loserId) {
    if (!merge) return;

    const before = window.Sweep.snapshot();
    const res = window.AcquireEngine.resolveMerger(state.game, null, merge.survivorId, loserId);

    // 即使引擎拒绝（例如公司已不存在），也必须把这一步算过去，
    // 否则队列永远停在当前下标 → AI 卡死
    if (!res.ok && res.reason) toast(res.reason);

    render();
    window.Sweep.queue(window.Sweep.diff(before));

    // 让状态机推进；它返回下一个被吞并公司，没有就说明整场并购结束
    const next = window.Merger.completeLoser ? window.Merger.completeLoser() : null;
    if (next) {
      setTimeout(stageDividend, 260);
    } else {
      finishMerger();
    }
  }

  /* 看门狗已经在 Merger 内部实现，这里不再重复 */
  function armMergeWatchdog() { /* no-op：保留调用点，逻辑在 js/merger.js */ }
  function clearMergeWatchdog() { window.Merger && window.Merger.abort(); }

  function finishMerger() {
    // 触发板块本身，以及和它相连的零散板块，都归入存活公司
    const beforeFinish = window.Sweep.snapshot();
    state.game.board[cellKey(merge.c, merge.r)] = merge.survivorId;
    (merge.absorb || []).forEach((k) => { state.game.board[k] = merge.survivorId; });
    const finishChanged = window.Sweep.diff(beforeFinish);

    syncShares();
    render();
    // 白板 + 被吸收的板块都属于「归属变化」，一起扫
    window.Sweep.queue(finishChanged);

    const summary = merge.lastSummary || '';
    const survivor = companyName(merge.survivorId);
    const size = window.AcquireEngine.companySize(state.game, merge.survivorId);

    const aiDriven = merge.aiDriven;
    const aiIdx = merge.aiIdx;
    merge = null;
    if (window.Merger) window.Merger.abort();

    if (window.Acquire) {
      if (window.Acquire.lockModal) window.Acquire.lockModal(false);
      window.Acquire.closeModal();
    }
    toast(`${summary ? summary + ' · ' : ''}${survivor} 现在规模 ${size} 块`);

    // AI 触发的并购结束后，把 AI 的回合走完；玩家触发的则进入购买阶段
    if (aiDriven) {
      afterAiPlacement(aiIdx);
    } else {
      resolveTurn();
    }
  }

  /** 落子完成后按类型分派后续交互 */
  function handlePlacement(result) {
    const a = result.analysis;

    if (a.type === 'found' && a.canFound) {
      showFoundModal(result.c, result.r);
      return;
    }
    if (a.type === 'merger') {
      startMerger(result);
      return;
    }

    reportPlacement(a);
    resolveTurn();
  }

  /* ------------------------------------------------------------ 回合流转 */

  /** 放置阶段结束 → 进入购买阶段 */
  function resolveTurn() {
    if (state.over) return;

    const end = window.AcquireEngine.checkEnd(state.game);
    if (end.over) { showEndGame(end); return; }

    state.phase = 'buy';
    state.actionTick = (state.actionTick || 0) + 1;

    /*
     * 剁手党：轮到你买股票、却一张都买不起的回合数。
     * 在这里判定最准 —— 刚进购买阶段，钱和股价都是最新的。
     */
    if (window.Career && isHuman(state.current)) {
      const me = state.players[state.current];
      const open = COMPANIES.filter((c) => (state.shares[c.id] || 0) > 0
        && window.AcquireEngine.companySize(state.game, c.id) >= 2);
      const cheapest = open.reduce((min, c) => {
        const p = priceOf(window.AcquireEngine.companySize(state.game, c.id), c.id);
        return p > 0 && (min === null || p < min) ? p : min;
      }, null);
      if (cheapest !== null && me.cash < cheapest) {
        window.Career.note('broke', {});
      }
    }
    resetTurnTimer();
    render();
  }

  /** 购买阶段结束 → 进入补充板块阶段（自动抽牌，稍后交给下一位） */
  /**
   * 第三阶段：补牌。
   *
   * 之前这里有两个坑：
   *   1. 用 state.phase !== 'draw' 当守卫 —— 这 420ms 内只要 phase 被动过，
   *      补牌就整个跳过（AI 少一张牌就是这么来的）；
   *   2. 补牌和 advanceTurn 写在同一个回调里，跳过补牌等于这一手也没收尾。
   *
   * 现在改成：
   *   - 用「本手补牌令牌」保证每人每回合只补一次，跟 phase 无关；
   *   - 补牌只认当时轮到的那个玩家，他已不是当前玩家就不补；
   *   - 收尾独立判断，补没补都要往下走。
   */
  function enterDrawPhase() {
    if (!state.players.length || state.over) return;

    const idx = state.current;
    state.phase = 'draw';
    state.actionTick = (state.actionTick || 0) + 1;

    const token = idx + '#' + state.actionTick;
    state.drawToken = state.drawToken || Object.create(null);

    resetTurnTimer();
    render();

    setTimeout(() => {
      if (state.over) return;
      if (state.current !== idx) return;      // 已经换人，不补
      if (state.drawToken[token]) return;     // 这一手已经补过
      state.drawToken[token] = true;

      const hand = state.hands[idx] || (state.hands[idx] = []);

      /*
       * 第三阶段不是「补一张」，而是「把手牌补到上限」。
       * 补充数 = 上限 − 当前持有数。
       * 平时手牌是 6 张，放置后剩 5 张 → 补 1 张；
       * 但如果之前弃过牌、或者用了扩展连锁之类的效果，就会一次补多张。
       */
      const need = Math.max(0, HAND_SIZE - hand.length);
      const added = [];

      for (let i = 0; i < need; i++) {
        const tile = drawFromDeck();
        if (!tile) break;
        hand.push(tile);
        added.push(coordLabel(tile[0], tile[1]));
      }

      if (added.length) {
        sfx('draw');
        toast(added.length === 1
          ? `补充 ${added[0]}`
          : `补充 ${added.length} 张：${added.join('、')}`);
      } else if (need > 0) {
        toast('牌堆已经空了');
      }

      render();

      setTimeout(() => {
        if (state.over) return;
        if (state.current !== idx) return;
        advanceTurn();
      }, 1000);
    }, 420);
  }

  /** 补充板块：从牌堆抽一块，然后交给下一位 */
  function drawTile() {
    const tile = drawFromDeck();
    const hand = state.hands[state.current];

    if (tile) {
      hand.push(tile);
      sfx('draw');
      toast(`抽到 ${coordLabel(tile[0], tile[1])}`);
    } else {
      toast('牌堆已经空了');
    }

    advanceTurn();
  }

  /* ------------------------------------------------------- 无法放置的兜底 */

  /** 手牌里有没有能放的 */
  function handHasPlayable(hand) {
    return (hand || []).some(([c, r]) => window.AcquireEngine.analyzePlacement(state.game, c, r).valid);
  }



  /**
   * 弃掉当前选中的那一块。
   *
   * 规则约束：
   *   - 只能在「放置板块」阶段用；
   *   - 每回合只能用一次；
   *   - 只能弃掉选中的那一张；
   *   - 弃掉的牌**移出本局**（不是放回牌堆）——这张坐标已经有板块了，
   *     这局再也不可能用到它。
   *
   * 注意：弃牌不等于放置。玩家可以在同一个放置阶段里先弃一张、再放一张。
   */
  function discardSelected() {
    if (state.phase !== 'place' || state.over) return;
    if (state.selected < 0) return;
    if (state.discardedThisTurn) { warn('这一回合已经弃过牌了'); return; }

    const hand = state.hands[state.current];
    const [c, r] = hand[state.selected];
    if (!c && c !== 0) {
      if (!hand[state.selected]) return;
    }

    hand.splice(state.selected, 1);
    state.selected = -1;
    state.target = null;
    state.discardedThisTurn = true;     // 本回合用过

    sfx('draw');
    render();
    toast(`弃掉 ${coordLabel(c, r)}（移出本局）`);
  }

  /** 交给下一位，回到放置阶段 */
  /**
   * 采集一帧复盘快照（每回合结束一次）。
   *
   * 只在「一整回合的人都走完」时记录，而不是每一步都记：
   * 一局 50 回合只需要 50 帧，存储和回放都轻得多，
   * 回放本来就是按回合看趋势的。
   */
  function recordReplayFrame() {
    if (!window.Career || !window.Career.recordFrame) return;

    const board = {};
    Object.keys(state.game.board).forEach((k) => { board[k] = state.game.board[k]; });

    window.Career.recordFrame({
      round: state.round,
      turn: state.current,
      board: board,
      players: state.players.map((p) => ({
        cash: p.cash,
        stocks: Object.assign({}, p.stocks),
      })),
      shares: Object.assign({}, state.shares),
      events: (state.roundEvents || []).slice(),
    });

    state.roundEvents = [];
  }

  /**
   * 回合汇总：每回合开头写一份「当前局面」，而不是只靠变化去猜。
   * 现金、持股、公司规模与股价各一行，便于直接读懂。
   */
  function writeRoundSummary() {
    if (!window.BattleLog) return;

    const sizes = computeSizes();
    const founded = window.AcquireEngine.foundedCompanies(state.game);
    const board = state.game.board;

    /* 公司：每家公司一行，规模 + 具体坐标 */
    const compLines = founded.map((id) => {
      const cells = Object.keys(board)
        .filter((k) => board[k] === id)
        .map((k) => {
          const p = k.split(',');
          return coordLabel(Number(p[0]), Number(p[1]));
        });
      return companyName(id) + ' 规模' + (sizes[id] || 0) + '：' + cells.join('、');
    });
    (compLines.length ? compLines : ['公司：无']).forEach((line) => window.BattleLog.add(line));

    /* 空白格 */
    const empty = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[cellKey(c, r)] === undefined) empty.push(coordLabel(c, r));
      }
    }
    window.BattleLog.add('空白格：' + (empty.length ? empty.join('、') : '无'));

    /* 每个玩家一行：现金 / 持股 / 手牌 */
    state.players.forEach((p, i) => {
      const held = founded
        .map((id) => [id, p.stocks[id] || 0])
        .filter((x) => x[1] > 0)
        .map((x) => companyName(x[0]) + x[1]);
      const hand = (state.hands[i] || []).map(([c, r]) => coordLabel(c, r));

      window.BattleLog.add('[汇总] ' + p.name + '：$' + (p.cash || 0)
        + '、持股：' + (held.length ? held.join('/') : '—')
        + '、手牌：' + (hand.length ? hand.join('、') : '—'));
    });
  }

  function advanceTurn() {
    // 一整个回合走完时存一帧（轮到最后一名玩家之后）
    if (state.current === state.players.length - 1) recordReplayFrame();

    state.current = (state.current + 1) % state.players.length;
    if (state.current === 0) {
      state.round += 1;
      // 新回合：切分记录并先写一份局面汇总
      if (window.BattleLog) {
        window.BattleLog.round(state.round);
        writeRoundSummary();
      }
    }
    state.phase = 'place';
    state.actionTick = (state.actionTick || 0) + 1;
    state.bought = 0;
    state.discardedThisTurn = false;   // 新回合可以再弃一次
    state.selected = -1;
    state.target = null;

    if (!state.hands[state.current] || !state.hands[state.current].length) {
      state.hands[state.current] = dealHand();
    }

    // 视角只在轮到你操控的角色时跟随，AI 回合保持不动
    if (isHuman(state.current)) state.viewer = state.current;

    render();

    // 轮到你：给一声提示音，把注意力拉回来
    if (!state.over && isHuman(state.current)) sfx('turn');

    // 轮到 AI 就自动行动
    if (!state.over && !isHuman(state.current)) scheduleAiTurn();

    // 看门狗：AI 如果在 40 秒内没有完成这一手，强制推它一下
    if (state.aiWatchdog) clearTimeout(state.aiWatchdog);
    state.aiWatchdog = null;
    if (!state.over && !isHuman(state.current)) {
      state.aiWatchdog = setTimeout(function rearm() {
        state.aiWatchdog = null;
        if (state.over || isHuman(state.current)) return;

        // 正在等玩家确认并购界面：这不是卡住，重新计时
        if (merge && merge.vote && !merge.vote.done) {
          state.aiWatchdog = setTimeout(rearm, 40000);
          return;
        }

        console.warn('[ai] watchdog: forcing turn to advance');
        try { advanceTurn(); } catch (e) { /* 兜底 */ }
      }, 40000);
    }
  }

  /* ---------------------------------------------------------------- AI */

  /**
   * AI 回合入口：出牌 → 买股 → 补牌。
   * 决策全部由 js/ai.js 提供（pickTile / pickBuys / pickStock / pickSurvivor）。
   */
  function scheduleAiTurn() {
    if (state.aiTimer) clearTimeout(state.aiTimer);
    // 假装思考：2~10 秒随机
    const speed = state.watch ? (state.aiSpeed || 1) : 1;
    const think = (1000 + Math.random() * 4000) / speed;   // 观战时按倍速加速
    state.aiTimer = setTimeout(runAiTurn, think);
  }

  /**
   * 复制一个玩家对象（含持股）。
   * 只给 AI 看，不共享引用 —— 决策层不允许改到牌桌状态。
   */
  function clonePlayer(p) {
    return Object.assign({}, p, { stocks: Object.assign({}, p.stocks || {}) });
  }

  /** 组装一份给 AI 看的上下文（严格只给公开信息） */
  function aiContext(idx) {
    const sizes = computeSizes();
    return {
      E: window.AcquireEngine,
      game: state.game,
      meIdx: idx,

      /*
       * 给 AI 的是**副本**，不是真玩家对象。
       *
       * 决策函数一旦顺手改了 ctx.me.cash（v1.9.24 就发生过），
       * 真实现金会被悄悄扣掉，而 aiBuy 之后还会再扣一次 ——
       * 每张股票扣两次，AI 越打越穷，而且不报错、测试也看不出来。
       *
       * 传副本之后，这类错误最多影响一次决策的分支判断，不会污染牌桌。
       */
      me: clonePlayer(state.players[idx]),
      players: state.players.map(clonePlayer),
      canSeeHoldings: !!state.openInfo,
      mode: state.mode,
      sizes,
      hand: state.hands[idx] || [],
      shares: state.shares || {},
      priceOf,
      payouts,
      rankHolders: rankHoldersLocal,
      computeDividends: window.AcquireEngine.computeDividends,
      difficulty: state.aiDifficulty || 'normal',
    };
  }

  function runAiTurn() {
    state.aiTimer = null;
    if (state.over) return;
    if (isHuman(state.current)) return;

    const idx = state.current;
    const E = window.AcquireEngine;
    const hand = state.hands[idx] || [];

    // 交给 AI 决策：打哪一块牌
    let choice = window.AcquireAI
      ? window.AcquireAI.pickTile(aiContext(idx))
      : null;

    /*
     * 没有能放的牌：先按规则书 §六② 弃掉一块（每回合一次），再试一次。
     * 与玩家共用同一条判定：analyzePlacement 不合法就是放不出去。
     */
    if (!choice && !state.discardedThisTurn) {
      const badIndex = window.Selectors.firstUnplayable(
        hand, (hc, hr) => E.analyzePlacement(state.game, hc, hr).valid);

      if (badIndex >= 0) {
        const [bc, br] = hand.splice(badIndex, 1)[0];
        state.discardedThisTurn = true;

        if (window.BattleLog) {
          window.BattleLog.add(state.players[idx].name + ' 弃掉放不出去的 '
            + coordLabel(bc, br));
        }
        sfx('draw');
        render();

        choice = window.AcquireAI ? window.AcquireAI.pickTile(aiContext(idx)) : null;
      }
    }

    // 弃完仍然没牌可放：这一手不落子，直接进购买阶段
    if (!choice) {
      afterAiPlacement(idx);
      return;
    }

    const c = choice[0];
    const r = choice[1];

    /*
     * 起跳点与人类完全一致：**底部手牌**那一张，而不是座位上的小方块。
     *
     * 之前 AI 从座位的牌格起飞，观战视角下看起来就像「凭空冒出一张牌」，
     * 和人类玩家的手感不一样。这里直接复用同一套视觉：
     *   量手牌位置 → 飞 → 落到棋盘 → placeAt（手牌由 placeAt 移除）
     */
    const pos = hand.findIndex(([a, b]) => a === c && b === r);

    /*
     * 起跳点要「量对」：
     *   底部手牌区显示的永远是 **viewer** 的牌。
     *   只有「正在行动的人 == 当前视角」时，那一格才是他的牌；
     *   否则（正常游玩里 AI 行动、你看的是自己）必须退回座位上的牌格，
     *   不然会把别人的牌当成起点，甚至取到 null。
     */
    const sameView = idx === state.viewer;
    const handTile = sameView
      ? document.querySelector('.hand-tile[data-index="' + pos + '"]')
      : null;
    const seatEl = document.querySelector(`.seat[data-p="${idx}"] .seat-tiles`);
    const cellEl = cellEls[r * COLS + c];

    const fromRect = (handTile || seatEl)
      ? (handTile || seatEl).getBoundingClientRect()
      : null;
    const toRect = cellEl ? cellEl.getBoundingClientRect() : null;

    /*
     * 顺序与人类完全一致：**先量位置 → 立刻从手里删掉 → 再飞**。
     *
     * 一定要在这里删。placeAt 只管棋盘，不碰手牌；
     * 如果把这句去掉，这块牌会一直留在手里被反复选中 —— 那是拿 A 换 B。
     */
    if (pos >= 0) hand.splice(pos, 1);
    state.selected = -1;
    state.target = null;

    render();

    // 飞行期间目标格先空着（用重绘后的新节点）
    if (cellEls[r * COLS + c]) cellEls[r * COLS + c].classList.add('awaiting-place');

    // 先浮现一张小牌、放大，再飞向目标格
    flyTile(fromRect, toRect, coordLabel(c, r), () => {
      sfx('place');

      const res = placeAt(c, r);
      if (!res.ok) { afterAiPlacement(idx); return; }

      render();

      // 触发并购时会弹「股票处置」，那一步结束后再收尾，不能立刻推进回合
      const deferred = resolveSilently(res.analysis, c, r);
      render();
      window.Sweep.queue(res.changed);
      if (!deferred) afterAiPlacement(idx);
    }, true);
  }

  /**
   * AI 落子结算完成后，走和玩家完全一样的两段：
   *   第二阶段 购买股票 → 第三阶段 补充板块
   * 每一段都会重置计时，所以进度条会像玩家那样「回满再走」。
   */
  function afterAiPlacement(idx) {
    if (state.over) return;

    // 清掉 AI 回合的看门狗：这里说明流程正常往下走了
    if (state.aiWatchdog) { clearTimeout(state.aiWatchdog); state.aiWatchdog = null; }

    if (window.AcquireEngine.checkEnd(state.game).over) {
      showEndGame(window.AcquireEngine.checkEnd(state.game));
      return;
    }

    resolveTurn();                       // → 第二阶段：购买（内部重置计时）

    setTimeout(function () {
      if (state.over || state.phase !== 'buy') return;
      aiBuy(idx);
      enterDrawPhase();                  // → 第三阶段：补牌（内部重置计时）
    }, (600 + Math.random() * 2000) / (state.watch ? (state.aiSpeed || 1) : 1));
  }

  /** AI 买股票：按 AI 的打分挑，扣钱、加股、扣股票池 */
  function aiBuy(idx) {
    if (!window.AcquireAI) return;

    const p = state.players[idx];
    const picks = window.AcquireAI.pickBuys(aiContext(idx)) || [];
    let bought = 0;

    picks.forEach((id) => {
      const size = window.AcquireEngine.companySize(state.game, id);
      const price = priceOf(size, id);
      if (!price) return;
      if ((state.shares[id] || 0) <= 0) return;
      if (p.cash < price) return;

      p.cash -= price;
      p.stocks[id] = (p.stocks[id] || 0) + 1;
      state.shares[id] -= 1;
      bought += 1;
      if (window.Career && isHuman(idx)) {
        window.Career.note('buy', { companyId: id, held: p.stocks[id], shares: n });
      }
    });

    if (bought) {
      sfx('cash');
      toast(`${p.name} 买入 ${bought} 张股票`);
      if (window.BattleLog) {
        const detail = {};
        picks.forEach((id) => { detail[id] = (detail[id] || 0) + 1; });
        window.BattleLog.add(p.name + ' 买入 ' + Object.keys(detail)
          .map((id) => detail[id] + ' 张 ' + companyName(id)).join('、'));
      }
    }
  }

  /**
   * AI 的创立 / 并购结算。
   * 返回 true 表示后续还要玩家操作（并购的股票处置弹窗），调用方不要立刻推进回合。
   */
  function resolveSilently(a, c, r) {
    const E = window.AcquireEngine;

    if (a.type === 'found' && a.canFound) {
      const free = COMPANIES.find((co) => !state.game.founded[co.id]);
      if (free) {
        const before = window.Sweep.snapshot();
        const res = E.foundCompany(state.game, free.id, c, r);
        if (res.ok) {
          sfx('found');
          initSharePool(free.id, 1);
          const p = state.players[state.current];
          p.stocks[free.id] = (p.stocks[free.id] || 0) + 1;
          window.Sweep.queue(window.Sweep.diff(before));
        }
      }
      return false;
    }

    if (a.type === 'merger') {
      /*
       * 走完整的并购结算流程：
       * 分红照发，但「被吞并公司的股票」必须由持有者逐张选择——
       * 哪怕这一手是 AI 打出的，你手里的股票也得你自己决定。
       */
      startMerger({ analysis: a, c, r }, true);
      return true;
    }

    return false;
  }

  /* ------------------------------------------------------------ 终局结算 */


  /**
   * 终局弹窗里的「生涯与成就」区块：
   * 本局解锁的成就 + 生涯累计概况，折叠在结算表格下面，不抢焦点。
   */


  function showEndGame(endInfo) {
    state.over = true;

    if (window.BattleLog) {
      const ranked = state.players
        .map((p) => p)
        .sort((a, b) => (b.cash || 0) - (a.cash || 0));
      window.BattleLog.finish('终局结算：' + ranked
        .map((p, k) => (k + 1) + '. ' + p.name + ' 总现金 $' + (p.cash || 0)).join('　'));
    }

    /*
     * 终局快照必须在这里拍：再往后就要发分红、把股票全部卖给银行。
     * 如果放在结算之后，历史战绩里的「结算前持股」会全是 0 —— 因为那时
     * 玩家手上已经没有股票了。
     */
    recordReplayFrame();
    // 记下结束时刻，计时器停在那一刻，不再往上走
    state.endedAt = state.startedAt ? Date.now() : 0;
    state.phase = 'buy';
    sfx('win');
    render();

    const founded = window.AcquireEngine.foundedCompanies(state.game);
    const dividends = Object.create(null);
    const companyRows = [];

    // 终局分红：所有存活公司各发一次
    founded.forEach((id) => {
      const size = window.AcquireEngine.companySize(state.game, id);

      /*
       * 规模不足 2 块的公司还没有价位档，payouts() 会返回 null。
       * 正常对局不会出现（公司成立时至少 2 块），但数据一旦有残留，
       * 这里会以「读 null.first」的形式崩掉，所以先跳过。
       */
      const pay = size >= 2 ? payouts(size, id) : null;
      if (!pay) return;

      const groups = rankHoldersLocal(id);
      const dist = window.AcquireEngine.computeDividends(state.mode, groups, pay);
      Object.keys(dist).forEach((k) => {
        dividends[k] = (dividends[k] || 0) + dist[k];
      });
      if (Object.keys(dist).length) {
        companyRows.push(`${companyName(id)}（${size} 块）：$${Object.values(dist).reduce((a, b) => a + b, 0).toLocaleString('en-US')}`);
      }
    });

    // 股票按终局股价全部卖给银行
    const proceeds = Object.create(null);
    state.players.forEach((p, i) => {
      let total = 0;
      Object.keys(p.stocks).forEach((id) => {
        const size = window.AcquireEngine.companySize(state.game, id);
        const price = priceOf(size, id) || 0;
        total += price * p.stocks[id];
      });
      proceeds[i] = total;
    });

    // 结算入账
    state.players.forEach((p, i) => {
      p.cash += (dividends[i] || 0) + (proceeds[i] || 0);
      p.stocks = Object.create(null);
    });

    // 写入生涯档案
    let careerResult = [];
    let careerPanelHTML = '';
    // 全场现金总额：寡头垄断第三档（一人单挑全场）要用
    const totalCash = state.players.reduce((n, p) => n + (p.cash || 0), 0);

    if (window.Career) {
      // 排序时保留原始下标，否则找不到「我是第几」（players 里没有 index 字段）
      const ranked = state.players
        .map((p, i) => ({ i, cash: p.cash }))
        .sort((a, b) => b.cash - a.cash);

      const mine = ranked.find((x) => x.i === state.viewer);
      // 并列同分同名次
      const myRank = mine
        ? ranked.filter((x) => x.cash > mine.cash).length + 1
        : state.players.length;

      const my = state.players[state.viewer];
      const second = ranked[0] && ranked[0].i !== state.viewer
        ? ranked[0]
        : ranked[1];
      /*
       * 除名次与现金外，再补几个「本局事实」给成就判定用：
       *   零持股夺冠（打工皇帝）、7 家全持（资本大鳄）、
       *   无安全公司靠 41 块结束（乱世求生）、现金最低值（铁公鸡）。
       */
      const myStockTotal = Object.keys(state.players[state.viewer].stocks || {})
        .reduce((n, id) => n + (state.players[state.viewer].stocks[id] || 0), 0);

      const sevenHold = founded.length >= 7
        && founded.every((id) => (state.players[state.viewer].stocks[id] || 0) > 0);

      const endReason = endInfo && endInfo.reason;
      const otherSafe = founded.some((id) => id !== (endInfo && endInfo.companyId)
        && window.AcquireEngine.companySize(state.game, id) >= SAFE_SIZE);
      const rushEnding = endReason === 'size41' && !otherSafe;

      /*
       * 不能用 ranking —— 它在这段代码下面才声明（const 暂时性死区），
       * 直接引用会抛 ReferenceError，把终局弹窗卡在 openModal 之前，
       * 现象就是「判定结束了但什么都没有弹」。
       */
      const sumOthersCash = totalCash
        - (state.players[state.viewer] ? state.players[state.viewer].cash : 0);

      const res = state.watch ? null : window.Career.finishMatch({
        rank: myRank,
        net: my ? my.cash : 0,
        rounds: state.round,
        difficulty: state.aiDifficulty,
        players: state.players.length,
        myCash: my ? my.cash : 0,
        secondCash: second ? second.cash : 0,
        sumOthersCash,
        mode: state.mode,
        names: state.players.map((p) => p.name),
        colors: state.players.map((p) => p.color),
        final: state.players.map((p, i) => ({
          cash: p.cash,
          dividend: dividends[i] || 0,
          sale: proceeds[i] || 0,
        })),
        humans: state.humans.slice(),
        ranks: state.players
          .map((p, i) => ({ i: i, cash: p.cash }))
          .sort((a, b) => b.cash - a.cash)
          .map((x) => x.i),
        minCash: state.minCash === null || state.minCash === undefined ? 6000 : state.minCash,
        zeroStock: myStockTotal === 0,
        rushEnding,
        sevenHold,
      });
      // 不再单独弹窗抢焦点，结果合并进终局弹窗里显示
      careerResult = (res && res.newly) ? res.newly : [];
    }

    const ranking = state.players
      .map((p, i) => ({ i, name: p.name, cash: p.cash, div: dividends[i] || 0, sale: proceeds[i] || 0 }))
      .sort((a, b) => b.cash - a.cash);

    const rows = ranking.map((r, rank) => `
      <tr class="${rank === 0 ? 'is-safe' : ''}">
        <td>${rank === 0 ? '🏆 ' : ''}${r.name}</td>
        <td>$${r.div.toLocaleString('en-US')}</td>
        <td>$${r.sale.toLocaleString('en-US')}</td>
        <td class="pay1">$${r.cash.toLocaleString('en-US')}</td>
      </tr>`).join('');

    const reason = endInfo.reason === 'size41'
      ? `${companyName(endInfo.companyId)} 达到 41 块`
      : '所有存活公司都进入安全状态';

    render();

    if (!window.Acquire) return;

    // 本局解锁的成就 + 生涯概览，直接嵌在终局弹窗里
    careerPanelHTML = buildCareerPanel(careerResult);

    window.Acquire.openModal({
      title: '终局结算',
      subtitle: `${reason}，游戏结束`,
      body: `
        <table class="data">
          <thead>
            <tr><th>玩家</th><th>终局分红</th><th>股票变卖</th><th>总现金</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p><strong>${ranking[0].name}</strong> 以 $${ranking[0].cash.toLocaleString('en-US')} 获胜。</p>
        ${companyRows.length ? `<p style="color:#74808f">终局分红：${companyRows.join('、')}</p>` : ''}

        ${careerPanelHTML}
      `,
      collapsible: true,
      actions: [{ label: '返回主菜单', className: 'btn--gold', onClick: () => {
        if (window.Acquire) window.Acquire.showScreen('menu');
      } }],
    });
  }

  /* ------------------------------------------------------------ 快捷键 */

  let tabHeld = false;

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key !== 'Tab' && modalOpen()) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (state.over || !isHuman(state.current)) return;
        if (state.phase === 'place') { warn('先放置一块建筑板块'); return; }
        if (state.phase === 'buy') enterDrawPhase();
        return;
      }

      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (state.over || !isHuman(state.current)) return;
        if (state.phase !== 'buy') { warn('现在还不能买股票'); return; }
        showBuyModal();
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();

        /*
         * 并购结算期间禁止用 Tab 偷看股东信息卡。
         * 并购弹窗是锁定的（lockModal），这时再叠一层信息卡，
         * 关又关不掉（关闭被锁拦下）、流程又被挡着 —— 画面直接卡死。
         */
        if (merge) return;

        if (!tabHeld) {
          tabHeld = true;
          showReference();          // 按住时显示
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Tab' && tabHeld) {
        tabHeld = false;
        if (window.Acquire) window.Acquire.closeModal();
      }
    });
  }

  /* ------------------------------------------------------------ 交互绑定 */

  /**
 * 悬停提示框的三类内容：棋盘格子 / 持股证书 / 顶栏术语。
 *
 * 放在 board.js 里是因为它们都要读 state —— 而 tooltip.js 本身不碰游戏数据。
 */
function setupBoardTooltips() {
  if (!window.Tooltip) return;
  window.Tooltip.install();

  /* 棋盘格子：归属公司、规模、已售 / 剩余股票 */
  window.Tooltip.register('tile', (el) => {
    const c = Number(el.dataset.c);
    const r = Number(el.dataset.r);
    const val = state.game.board[c + ',' + r];
    const label = coordLabel(c, r);

    if (val === undefined) {
      return { title: label + ' · 空地', html: '还没有板块，可以在这里落子。' };
    }
    if (val === null) {
      return {
        title: label + ' · 零散板块',
        html: '还没连成公司。再连上一块就会触发创立公司。',
      };
    }

    const co = COMPANY_BY_ID[val];
    const size = window.AcquireEngine.companySize(state.game, val);
    const left = state.shares[val] === undefined ? 25 : state.shares[val];
    const sold = Math.max(0, 25 - left);
    const price = priceOf(size, val);

    return {
      title: co.mark + ' ' + co.name,
      html: '<div class="tip-row"><span class="tip-k">当前规模</span><b>' + size + ' 块</b></div>'
        + '<div class="tip-row"><span class="tip-k">股价</span><b>$' + (price || 0) + '</b></div>'
        + '<div class="tip-row"><span class="tip-k">已售股票</span><b>' + sold + ' 张</b></div>'
        + '<div class="tip-row"><span class="tip-k">剩余股票</span><b>' + left + ' 张</b></div>',
      meta: size >= SAFE_SIZE
        ? '已达安全规模，不可被吞并'
        : '还需 ' + (SAFE_SIZE - size) + ' 块达到安全规模',
    };
  });

  /* 持股卡：把精美证书搬进提示框 */
  window.Tooltip.register('hold', (el) => {
    const id = el.dataset.cid;
    const co = COMPANY_BY_ID[id];
    const p = state.players[state.viewer];
    const count = (p && p.stocks && p.stocks[id]) || 0;
    if (!co || !count) return null;

    const size = window.AcquireEngine.companySize(state.game, id);
    const price = priceOf(size, id) || 0;

    // 证书本体是 424×268，靠 .tip-cert 的 zoom 缩到提示框里
    const meta = price > 0
      ? count + ' 张 · 现价 $' + price + ' · 市值 $' + (count * price).toLocaleString('en-US')
      : count + ' 张 · 该公司还没上市，暂无股价';

    return {
      html: '<div class="tip-cert">' + fullCertHTML(co, count) + '</div>',
      meta: meta,
      plain: true,
    };
  });

  /* 顶栏术语：现场教学 */
  window.Tooltip.register('ui', (el) => {
    const terms = {
      round: ['当前回合', '所有人各行动一次算一回合。'],
      safe: ['安全规模', '公司达到 11 块后不可被吞并。'],
      end: ['终局触发', '任一公司达到 41 块，或所有存活公司都达到 11 块，游戏立即结束。'],
      deck: ['剩余板块', '牌堆里还没抽到的板块数。牌堆空了之后每回合不再补牌。'],
    };
    const t = terms[el.dataset.term];
    if (!t) return null;
    return { title: t[0], html: t[1] };
  });
}

/* ---------------------------------------------------------------- 观战 */

/**
 * 切换观战视角。
 * 换的只是「看谁」——手牌、持股、座位方位都跟着变，
 * 但一切操作仍然被 isHuman() 挡着。
 */
function setWatchViewer(idx) {
  if (!state.watch) return;
  const n = state.players.length;
  if (!n) return;
  state.viewer = ((idx % n) + n) % n;
  state.selected = -1;
  state.target = null;
  render();
  updateWatchBar();
}

function updateWatchBar() {
  const el = document.getElementById('watchView');
  if (!el) return;
  const p = state.players[state.viewer];
  el.textContent = p ? p.name : '—';
}

function bindEvents() {
  // 观战视角切换 + 思考时间
  const prevBtn = document.getElementById('watchPrev');
  const nextBtn = document.getElementById('watchNext');
  if (prevBtn) prevBtn.addEventListener('click', () => setWatchViewer(state.viewer - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => setWatchViewer(state.viewer + 1));

  /*
   * 思考时间按钮：一开始要把「标准」点亮。
   * 之前只绑了点击，没有初始态 —— 进观战时三个按钮都不亮，像是没选中任何一档。
   */
  function syncSpeedButtons() {
    if (!state.aiSpeed) state.aiSpeed = 1;
    document.querySelectorAll('.watch-speed button').forEach((b) => {
      b.classList.toggle('is-on', Number(b.dataset.speed) === Number(state.aiSpeed));
    });
  }

  document.querySelectorAll('.watch-speed button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.aiSpeed = Number(btn.dataset.speed) || 1;
      syncSpeedButtons();
    });
  });
  syncSpeedButtons();

    /*
     * 旧的「悬停放大证书」不再绑定 —— 已由悬停提示框统一接管，
     * 两套浮层同时存在会互相打架。
     */
    setupBoardTooltips();
    // 手牌：选中 / 取消（选中后棋盘上对应格子会亮起来）
    $('#handTiles').addEventListener('click', (e) => {
      const btn = e.target.closest('.hand-tile');
      if (!btn) return;

      if (modalOpen()) return;   // 事件弹窗未处理完，禁止操作
      if (state.over) { warn('对局已经结束了'); return; }
      if (!isHuman(state.current)) { warn('等待 AI 行动'); return; }
      if (state.phase !== 'place') { warn('本回合已经放置过板块了，点「结束购买」推进'); return; }

      const idx = Number(btn.dataset.index);
      state.selected = state.selected === idx ? -1 : idx;
      sfx('select');
      render();
    });

    // 棋盘：只能把牌放到它自己那一格
    $('#boardGrid').addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;

      const c = Number(cell.dataset.c);
      const r = Number(cell.dataset.r);

      if (modalOpen()) return;   // 事件弹窗未处理完，禁止操作
      if (state.selected < 0) { warn('先在下方选一块手牌'); return; }
      if (!isHuman(state.current)) { warn('等待 AI 行动'); return; }
      if (!state.target) return;

      if (state.target.c !== c || state.target.r !== r) {
        warn(`这块牌只能放在 ${coordLabel(state.target.c, state.target.r)}`);
        return;
      }

      if (!state.target.legal) {
        warn(state.target.analysis.reason || '这一格放不下去');
        return;
      }

      // 先把起点（手牌）和终点（棋盘格）的位置量下来
      const handEl = $('#handTiles').querySelector(`.hand-tile[data-index="${state.selected}"]`);
      const fromRect = handEl ? handEl.getBoundingClientRect() : null;
      const cellEl = cellEls[r * COLS + c];
      const toRect = cellEl ? cellEl.getBoundingClientRect() : null;
      const text = coordLabel(c, r);

      // 这块牌从手牌里拿掉，稍后在补充阶段再摸一张补回来
      const hand = state.hands[state.current];
      hand.splice(state.selected, 1);
      state.selected = -1;
      state.target = null;

      /*
       * 关键：这里**先不改棋盘**。
       * 之前是 applyPlacement 立刻执行，导致相邻的零散方块在手牌还没飞到位时
       * 就已经变成公司色 —— 视觉顺序反了。现在把手牌落地当作结算的起点。
       */
      render();

      // 飞行期间目标格先空着，落地再显形（都要用重绘后的节点）
      if (cellEls[r * COLS + c]) cellEls[r * COLS + c].classList.add('awaiting-place');

      flyTile(fromRect, toRect, text, () => {
        sfx('place');

        // 牌到位了才开始结算：白板归属 → 相邻方块并入 → 并购/创立
        const result = placeAt(c, r);
        if (!result.ok) { warn(result.reason); return; }

        render();
        window.Sweep.queue(result.changed);
        handlePlacement(result);
      });
    });

    // 顶栏
    $('#btnFlow').addEventListener('click', showFlow);
    $('#btnRef').addEventListener('click', showReference);
    $('#btnRules').addEventListener('click', () => {
      if (window.Acquire && window.Acquire.showRules) window.Acquire.showRules();
    });

    $('#btnBack').addEventListener('click', () => {
      if (window.Acquire) window.Acquire.showScreen('menu');
    });

    // 买股票
    $('#btnBuy').addEventListener('click', () => {
      if (modalOpen()) return;
      showBuyModal();
    });

    // ③ 结束购买（补充板块是自动的，不需要点）
    $('#btnEndTurn').addEventListener('click', () => {
      if (modalOpen()) return;
      if (state.over) { warn('对局已经结束了'); return; }
      if (state.phase === 'place') { warn('先放置一块建筑板块'); return; }
      if (state.phase === 'buy') { enterDrawPhase(); return; }
    });

    // 弃掉放不下去的那一块
    $('#btnDiscard').addEventListener('click', () => {
      if (modalOpen()) return;
      discardSelected();
    });

    // 尺寸自适应：观察牌桌区域（不要观察 board-area，它随棋盘收缩，会形成反馈循环）
    const mid = document.querySelector('.table-mid');
    if (window.ResizeObserver && mid) {
      const ro = new ResizeObserver(() => layoutBoard());
      ro.observe(mid);
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      layoutBoard();
      // 座位分区依赖窗口宽度，跨断点时重排
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { renderSeats(); layoutBoard(); }, 120);
    });
  }

  /* -------------------------------------------------------------- 对外接口 */

  /** 离开牌桌：停掉一切计时与 AI 调度 */
  function suspendGame() {
    state.paused = true;
    state.startedAt = 0;
    state.over = true;
    if (state.aiTimer) { clearTimeout(state.aiTimer); state.aiTimer = null; }
    if (window.TurnTimer) window.TurnTimer.stop();
  }

  window.suspendGame = suspendGame;

  // 艺术画廊要用同一套证书渲染，直接暴露出去
  window.AcquireGallery = {
    certHTML: fullCertHTML,
    companies: COMPANIES,
  };

  window.startGame = function (config) {
    const count = config && config.players ? Number(config.players) : 4;

    state.players = Array.from({ length: count }, (_, i) => ({
      name: `玩家 ${i + 1}`,
      cash: START_CASH,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      stocks: Object.create(null),      // companyId -> 持有张数
    }));
    state.current = 0;
    state.round = 1;
    state.selected = -1;
    state.hands = Array.from({ length: count }, () => []);
    state.shares = {};

    // 回合阶段
    state.phase = 'place';
    state.bought = 0;
    state.over = false;
    state.lastSeatHand = [];

    // 信息公开：关掉之后看不到别人的现金和持股
    state.openInfo = !(config && config.openInfo === false);

    const modeEl = $('#gameMode');
    const tycoon = !!(config && config.mode === 'tycoon');
    state.mode = tycoon ? 'tycoon' : 'classic';
    if (modeEl) {
      modeEl.textContent = tycoon ? '大亨模式' : '经典模式';
      modeEl.classList.toggle('is-tycoon', tycoon);
      modeEl.classList.toggle('is-classic', !tycoon);
    }

    // 引擎对象重建：棋盘与公司状态都归它管
    state.game = window.AcquireEngine.createGame({ players: count, mode: state.mode });

    if (window.Acquire) window.Acquire.showScreen('game');

    // 你操控的角色（0 基下标），其余交给 AI
    state.humans = normalizeHumans(config && config.humans, count);
    state.aiDifficulty = (config && config.aiDifficulty) || 'normal';
    state.waitTime = (config && config.waitTime) || 'medium';
    if (window.Career && state.humans.length) {
      window.Career.startMatch({ players: count, mode: state.mode, aiDifficulty: state.aiDifficulty });
    }
    state.startedAt = 0;          // 开局简报关掉后才开始计时
    state.endedAt = 0;
    state.minCash = null;         // 本局现金最低值（铁公鸡）
    state.roundEvents = [];       // 本回合发生的事件（记进复盘帧）

    // 文字版对局记录
    if (window.BattleLog) {
      window.BattleLog.begin({
        title: '并购风云 · 对局记录',
        mode: state.mode === 'tycoon' ? '大亨模式' : '经典模式',
        players: state.players.map((p, i) => ({
          name: p.name,
          isAi: !isHuman(i),
          difficulty: state.aiDifficulty,
        })),
      });
    }

    // 第 1 回合开局汇总（开局时公司还没成立，写的是空盘状态）
    if (window.BattleLog) writeRoundSummary();

    // 新局：AI 的记忆与性格全部重置（否则上一局的仇恨会带过来）
    if (window.AcquireAI && window.AcquireAI.resetBrains) window.AcquireAI.resetBrains();
    /*
     * 没有真人 → 全员 AI 观战局。
     * 视角固定在 0 号座位（纯观察，不参与任何决策）。
     */
    state.watch = !state.humans.length;
    if (state.watch && !state.aiSpeed) state.aiSpeed = 1;   // 观战倍速：0.5 慢 / 1 标准 / 3 快
    state.viewer = state.humans.length ? state.humans[0] : 0;
    document.body.classList.toggle('is-watch', state.watch);
    state.aiTimer = null;

    // 空棋盘开局：铺满牌堆后给每人发 6 块
    newGameLayout();
    render();

    requestAnimationFrame(() => {
      layoutBoard();
      requestAnimationFrame(layoutBoard);
    });

    // 开局简报
    setTimeout(showMatchInfo, 320);
  };

  /** 把配置里的 humans 规范成合法下标数组；允许为空（全 AI 观战） */
  function normalizeHumans(value, total) {
    const list = Array.isArray(value)
      ? value.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < total)
      : [];
    const uniq = Array.from(new Set(list)).sort((a, b) => a - b);
    // 允许为空 —— 空数组 = 全员 AI 观战局
    return uniq;
  }

  /** 事件弹窗（展开或收纳）存在时，任何操作都不许通过 */
  function modalOpen() {
    return !!(window.Acquire && window.Acquire.isModalOpen && window.Acquire.isModalOpen());
  }

  function isHuman(index) {
    if (!Array.isArray(state.humans)) return true;
    return state.humans.indexOf(index) >= 0;
  }

  /** 简报关闭的那一刻才真正开局 */
  function beginMatch() {
    if (state.startedAt) return;          // 只执行一次
    state.startedAt = Date.now();
    state.paused = false;
    resetTurnTimer();
    updateClock();
    render();

    // 第一个玩家如果是 AI，立刻让它开始思考
    if (!state.over && !isHuman(state.current)) scheduleAiTurn();
  }

  /** 开局简报：本局有谁、谁是人、谁是 AI */
  function showMatchInfo() {
    if (!window.Acquire) return;

    const humans = state.humans.map((i) => state.players[i].name);
    const ais = state.players.filter((p, i) => !isHuman(i)).map((p) => p.name);

    const rows = state.players.map((p, i) => {
      const human = isHuman(i);
      return `
        <div class="lineup-row ${human ? 'is-human' : ''}">
          <span class="lineup-dot" style="--p:${p.color}"></span>
          <span class="lineup-name">${p.name}</span>
          <span class="lineup-tag ${human ? 'is-human' : 'is-ai'}">${human ? '你' : 'AI'}</span>
        </div>`;
    }).join('');

    window.Acquire.openModal({
      title: '对局开始',
      subtitle: `${state.players.length} 位角色 · ${humans.length} 位由你操控 · ${ais.length} 位由 AI 接管`,
      body: `
        <div class="lineup">${rows}</div>
        <div class="match-facts">
          <span>模式 <b>${state.mode === 'tycoon' ? '大亨' : '经典'}</b></span>
          <span>起始现金 <b>$6,000</b></span>
          <span>信息公开 <b>${state.openInfo ? '开启' : '关闭'}</b></span>
          ${ais.length ? `<span>AI 难度 <b>${DIFF_NAME[state.aiDifficulty] || '普通'}</b></span>` : ''}
        </div>

      `,
      onClose: () => beginMatch(),
      actions: [{
        label: '开始',
        className: 'btn--gold',
        onClick: () => { /* 真正开局在 onClose 里做，保证怎么关都算 */ },
      }],
    });


  }

  /* ---------------------------------------------------------------- 启动 */

  function init() {
    buildBoard();
    bindEvents();

    // 回合计时器与对局时钟
    setInterval(tickTurnTimer, 100);
    setInterval(updateClock, 500);
    bindKeyboard();

    state.game = window.AcquireEngine.createGame({ players: 1, mode: 'classic' });
    state.hands = [[]];
    rebuildDeck();
    state.hands[0] = dealHand();
    render();

    // 调试用：index.html#game 直接进入桌面
    if (location.hash === '#game' && window.Acquire) {
      window.startGame(window.Acquire.getSettings());
    }
  }

  /*
   * 把股票处置模块需要的东西喂给它（依赖注入）。
   * 放在这里是因为此时上面所有函数都已定义完毕。
   */
  /*
   * 扫光模块需要知道棋盘和格子节点在哪。
   */
  window.BoardViewTray.install({ qs: (sel) => $(sel) });

  window.BoardViewSeats.install({ qs: (sel) => $(sel) });

  window.BoardViewHand.install({ qs: (sel) => $(sel) });

  window.BoardViewCompanies.install({
    getCompanies: () => COMPANIES,
    getTierNames: () => TIER_NAMES,
    getSafeSize: () => SAFE_SIZE,
    priceOf: (size, id) => priceOf(size, id),
    hexToRgba: (hex, a) => hexToRgba(hex, a),
    qs: (sel) => $(sel),
  });

  window.Sweep.install({
    getBoard: () => state.game.board,
    getCellEls: () => cellEls,
    cols: () => COLS,
  });

  window.StockDisposal.install({
    getState: () => state,
    getMerge: () => merge,
    priceOf: (size, id) => priceOf(size, id),
    companyName: (id) => companyName(id),
    renderTray: () => renderTray(),
    refreshPoolLabel: () => refreshStockPoolLabel(),
    completeStep: (id) => completeStep(id),
    // —— 股票处置界面需要的东西 ——
    aiStockRowHTML: (h, d, p, isAi) => aiStockRowHTML(h, d, p, isAi),
    stockGuideHTML: (a, b) => stockGuideHTML(a, b),
    mergeModal: (t, s, b, a) => mergeModal(t, s, b, a),
    voteFooterHTML: () => voteFooterHTML(),
    voteBtnHTML: (i) => voteBtnHTML(i),
    beginVote: (o) => beginVote(o),
    refreshVoteUI: () => refreshVoteUI(),
    isHuman: (i) => isHuman(i),
    aiContext: (i) => aiContext(i),
    holdWatchdog: () => { if (window.Merger) window.Merger.holdWatchdog(); },
    releaseWatchdog: () => { if (window.Merger) window.Merger.releaseWatchdog(); },
  });

  // 调试钩子：startMerger 用来构造并购，showEndGame 用来验证终局界面
  window.__dbg = { state, startMerger, showEndGame, getMerge: () => merge };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();