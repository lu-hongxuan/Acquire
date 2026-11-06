/* ==========================================================================
   并购风云 · ACQUIRE 60 周年纪念版
   主菜单脚本：动效装饰 / 弹窗系统 / 设置持久化
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */

  /*
   * 公司数据只有一个来源：board.js 里的展示表（id / 名称 / 字母 / 颜色 / 档位）。
   * 菜单和游戏共用它，避免出现游戏里没有的公司、或颜色对不上。
   * 用函数延迟取，因为 board.js 在本文件之后才加载。
   */
  function companies() {
    if (window.AcquireGallery && window.AcquireGallery.companies) {
      return window.AcquireGallery.companies;
    }
    return [];
  }

  const DEFAULTS = {
    sound: true,
    motion: true,
    players: 4,
    humans: [0],            // 你操控的角色下标，其余交给 AI
    mode: 'classic',        // classic | tycoon
      openInfo: true,
    aiDifficulty: 'normal',  // easy | normal | hard
    waitTime: 'medium',      // short | medium | long
    hoverDelay: 'normal',    // 悬停响应：fast | normal | slow
    volume: 1,               // 0~1
    companyNames: {},       // { companyId: { name, mark } } 只存自定义覆盖
  };

  /** 版本号只有一个来源：关于、控制台、主菜单底部都读它 */
  const VERSION = '0.9.0-demo';

  const STORAGE_KEY = 'acquire.settings';

  /* ---------------------------------------------------------------- 状态 */

  let settings = loadSettings();

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? Object.assign({}, DEFAULTS, JSON.parse(raw)) : Object.assign({}, DEFAULTS);
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) { /* 隐私模式等场景下静默失败 */ }
  }

  /* -------------------------------------------------------------- DOM 引用 */

  const $ = (sel) => document.querySelector(sel);

  const overlay      = $('#overlay');
  const modalTitle   = $('#modalTitle');
  const modalBody    = $('#modalBody');
  const modalActions = $('#modalActions');
  const modalClose   = $('#modalClose');
  const modalCollapseEl = $('#modalCollapse');
  const toastEl      = $('#toast');

  /* ------------------------------------------------------------ 背景装饰 */

  function renderCompanyDots() {
    const wrap = $('#companies');
    if (!wrap) return;
    wrap.innerHTML = companies()
      .map((c) => `<span class="company-dot" style="--c:${c.color}" title="${c.name}"></span>`)
      .join('');
  }

  let tilesRendered = false;

  function renderFloatingTiles() {
    const wrap = $('#bgTiles');
    if (!wrap || tilesRendered) return;
    tilesRendered = true;

    const count = window.matchMedia('(max-width: 640px)').matches ? 9 : 16;
    const frag = document.createDocumentFragment();

    for (let i = 0; i < count; i++) {
      const all = companies();
      const company = all[i % all.length];
      const tile = document.createElement('span');
      tile.className = 'tile';

      const size = 14 + Math.random() * 16;
      tile.style.left = `${Math.random() * 96}%`;
      tile.style.top = `${85 + Math.random() * 25}%`;
      tile.style.width = `${size}px`;
      tile.style.height = `${size}px`;
      tile.style.background = `linear-gradient(145deg, ${company.color}dd, ${company.color}88)`;
      tile.style.animationDuration = `${16 + Math.random() * 16}s`;
      tile.style.animationDelay = `${-Math.random() * 30}s`;

      frag.appendChild(tile);
    }

    wrap.appendChild(frag);
  }

  /* -------------------------------------------------------------- Toast */

  let toastTimer = null;

  let modalLocked = false;

  function toast(message, duration = 3300) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), duration);
  }

  /* --------------------------------------------------------------- 弹窗 */

  let modalOnClose = null;

  function openModal({ title, subtitle, body, actions = [], collapsible = false, onClose = null }) {
    // 弹窗与提示框互斥：先收起提示框，避免它压在弹窗上
    if (window.Tooltip) window.Tooltip.close();
    const modal = document.querySelector('#overlay .modal');
    if (modal) {
      resetModalShape(modal);
      // 只有游戏内的事件弹窗才能收起成横幅
      modal.classList.toggle('is-collapsible', !!collapsible);
    }

    modalOnClose = typeof onClose === 'function' ? onClose : null;

    modalTitle.textContent = title;
    const barTitle = document.getElementById('modalBarTitle');
    if (barTitle) barTitle.textContent = title;

    modalBody.innerHTML = subtitle
      ? `<p class="modal-sub">${subtitle}</p>${body}`
      : body;

    modalActions.innerHTML = actions
      .map((a, i) => `<button class="btn ${a.className || 'btn--ghost'}" data-index="${i}">${a.label}</button>`)
      .join('');

    // 用事件委托：内容被重写后依然有效
    if (!modalActions._bound) {
      modalActions._bound = true;
      modalActions.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-index]');
        if (!btn) return;

        const handlers = modalActions._handlers || [];
        const action = handlers[Number(btn.dataset.index)];
        if (!action) return;

        let failed = null;
        try {
          if (typeof action.onClick === 'function') action.onClick();
        } catch (err) {
          failed = err;
          console.error('[modal action]', err);
        } finally {
          // 关键：无论回调是否抛错，都要把弹窗关掉，
          // 否则按钮看起来就是「点了没反应」
          if (action.keepOpen !== true) closeModal();
          if (failed) toast('操作出错：' + (failed.message || failed));
        }
      });
    }
    modalActions._handlers = actions;

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';

    /*
     * 重播出现动画。
     * .modal 一直留在 DOM 里（只是把 overlay 隐藏），
     * 浏览器不会因为「再次显示」而重新播放 CSS 动画 ——
     * 所以这里显式移除类、强制回流、再加回来。
     */
    {
      const m = document.querySelector('#overlay .modal');
      if (m) {
        m.classList.remove('is-animating');
        void m.offsetWidth;
        m.classList.add('is-animating');
      }
    }

    modalBody.scrollTop = 0;

    if (window.bindModalWidgets) window.bindModalWidgets();
  }

  function closeModal() {
    // 并购结算分好几步，中途不允许关掉，否则棋盘会停在半结算状态
    if (modalLocked) return;

    const modal = document.querySelector('#overlay .modal');
    if (modal) resetModalShape(modal);

    overlay.hidden = true;
    document.body.style.overflow = '';
    modalBody.innerHTML = '';
    modalActions.innerHTML = '';

    // 关掉了就等于「这件事处理完了」，把锁一并解开
    modalLocked = false;
    if (modalClose) modalClose.style.visibility = '';

    // 通知调用方「弹窗确实关掉了」
    const cb = modalOnClose;
    modalOnClose = null;
    if (cb) {
      try { cb(); } catch (e) { /* 忽略回调里的错误 */ }
    }
  }

  /** 锁定 / 解锁弹窗关闭（并购向导期间用） */
  function lockModal(value) {
    modalLocked = !!value;
    /*
     * 弹窗分两类，规则固定：
     *
     *   必须处理完的（collapsible = true，如创立公司、并购向导）
     *     → 没有 X，必须有缩放按钮，点遮罩 = 点缩放
     *
     *   其余（collapsible = false，如关于、规则书、买股票）
     *     → 有 X，没有缩放按钮，点遮罩什么都不发生
     */
    // X 与缩放按钮的显隐由 .is-collapsible 这个类控制（见 style.css），
    // 这里只处理「锁住」的情况
    if (modalClose) {
      modalClose.style.visibility = modalLocked ? 'hidden' : '';
    }
  }

  /* ------------------------------------------------ 事件弹窗「收纳成横幅」 */

  let modalCollapsed = false;

  /** 清掉收纳时写的内联样式，回到默认居中形态 */
  function resetModalShape(modal) {
    if (modalCollapsed) {
      modal.classList.remove('is-collapsed');
      overlay.classList.remove('is-collapsed');
      modal.style.cssText = '';
    }
    modalCollapsed = false;
    syncCollapseBtn();
  }

  function syncCollapseBtn() {
    if (!modalCollapseEl) return;
    modalCollapseEl.textContent = modalCollapsed ? '⤢' : '▾';
    modalCollapseEl.setAttribute('aria-label', modalCollapsed ? '展开' : '收起');
    modalCollapseEl.title = modalCollapsed ? '展开' : '收起为横幅';
  }

  /**
   * 收纳 / 展开事件弹窗。
   * 收纳：以上半部分为基准压成一条横幅（宽度不变、高度约一个地块），移动到左上角。
   * 遮罩层保留，所以收纳期间棋盘、手牌、股票全部点不动。
   */
  function toggleModalCollapsed(force) {
    const modal = document.querySelector('#overlay .modal');
    if (!modal || overlay.hidden) return;

    const next = typeof force === 'boolean' ? force : !modalCollapsed;
    if (next === modalCollapsed) return;

    const r = modal.getBoundingClientRect();

    // 先钉成具体像素，才能从当前位置平滑过渡
    modal.style.position = 'fixed';
    modal.style.margin = '0';
    modal.style.maxHeight = 'none';
    modal.style.left = r.left + 'px';
    modal.style.top = r.top + 'px';
    modal.style.width = r.width + 'px';
    modal.style.height = r.height + 'px';
    void modal.offsetWidth;

    modal.style.transition =
      'left .34s cubic-bezier(.22,1,.36,1), top .34s cubic-bezier(.22,1,.36,1),'
      + ' width .34s cubic-bezier(.22,1,.36,1), height .34s cubic-bezier(.22,1,.36,1),'
      + ' border-radius .34s, padding .34s';

    modalCollapsed = next;
    syncCollapseBtn();

    if (next) {
      modal._expanded = { width: r.width, height: r.height };
      modal.classList.add('is-collapsed');
      overlay.classList.add('is-collapsed');
      setTimeout(function () {
        modal.style.left = '0px';
        modal.style.top = '150px';
        modal.style.width = '48px';
        modal.style.height = '210px';
        modal.style.padding = '0';
      }, 16);
    } else {
      const keep = modal._expanded || { width: 560, height: 420 };
      const left = Math.max(14, (window.innerWidth - keep.width) / 2);
      const top = Math.max(14, (window.innerHeight - keep.height) / 2);

      modal.classList.remove('is-collapsed');
      overlay.classList.remove('is-collapsed');
      modal.style.padding = '';

      setTimeout(function () {
        modal.style.left = left + 'px';
        modal.style.top = top + 'px';
        modal.style.width = keep.width + 'px';
        modal.style.height = keep.height + 'px';
      }, 16);

      setTimeout(function () {
        if (!modalCollapsed) modal.style.cssText = '';
      }, 380);
    }
  }

  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay || modalCollapsed) return;

    /*
     * 点遮罩 = 请求「缩小这个弹窗」。
     * 所以只有**能收纳**的事件弹窗（并购向导、终局结算）才响应；
     * 创立公司、买股票这类必须选一项才能继续的弹窗，点遮罩一律无效 ——
     * 否则关掉之后这一步被跳过，棋盘状态和流程就脱节了
     * （曾经因此可以在一个回合里连打 6 张牌）。
     */
    /*
     * 点遮罩的效果「等同于点缩放按钮」：
     *   - 有缩放按钮的弹窗 → 收起/展开；
     *   - 没有缩放按钮的弹窗 → 什么都不做。
     */
    const modal = document.querySelector('#overlay .modal');
    if (!modal || !modal.classList.contains('is-collapsible')) return;

    toggleModalCollapsed();
  });
  modalClose.addEventListener('click', () => {
    if (modalLocked) return;
    if (modalCollapsed) { toggleModalCollapsed(false); return; }
    closeModal();
  });
  if (modalCollapseEl) {
    modalCollapseEl.addEventListener('click', () => toggleModalCollapsed());
  }
  const modalBar = document.querySelector('.modal-bar');
  if (modalBar) modalBar.addEventListener('click', () => toggleModalCollapsed(false));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || overlay.hidden) return;
    if (modalCollapsed) { toggleModalCollapsed(false); return; }
    closeModal();
  });

  /* ----------------------------------------------------------- 控件构造 */

  function switchRow(label, note, checked, onToggle) {
    const id = `sw-${Math.random().toString(36).slice(2, 8)}`;
    window.__widgetHandlers = window.__widgetHandlers || {};
    window.__widgetHandlers[id] = { type: 'switch', onToggle };

    return `
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">${label}</span>
          <span class="setting-note">${note}</span>
        </div>
        <button class="switch" id="${id}" role="switch" aria-checked="${checked}" aria-label="${label}"></button>
      </div>`;
  }

  function segmentedRow(label, note, options, value, onPick) {
    const id = `sg-${Math.random().toString(36).slice(2, 8)}`;
    window.__widgetHandlers = window.__widgetHandlers || {};
    window.__widgetHandlers[id] = { type: 'segmented', onPick };

    const buttons = options
      .map((o) => `<button data-value="${o.value}" class="${o.value === value ? 'is-active' : ''}">${o.label}</button>`)
      .join('');

    return `
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">${label}</span>
          <span class="setting-note">${note}</span>
        </div>
        <div class="segmented" id="${id}">${buttons}</div>
      </div>`;
  }

  // 每次弹窗打开后重新绑定动态控件
  /*
   * 历史战绩卡片：用事件委托挂在 modalBody 上，只绑一次。
   * 之前是每次弹窗打开时遍历 [data-replay] 单独绑定 —— 只要绑定时机
   * 早于内容写入，卡片就永远点不开。
   */
  if (!modalBody._replayBound) {
    modalBody._replayBound = true;
    modalBody.addEventListener('click', (e) => {
      const card = e.target.closest && e.target.closest('[data-replay]');
      if (!card) return;
      const id = card.dataset.replay;
      closeModal();
      if (window.History) window.History.open(id);
    });
  }

  window.bindModalWidgets = function () {

    const handlers = window.__widgetHandlers || {};

    modalBody.querySelectorAll('.switch').forEach((el) => {
      const h = handlers[el.id];
      if (!h) return;
      el.addEventListener('click', () => {
        const next = el.getAttribute('aria-checked') !== 'true';
        el.setAttribute('aria-checked', String(next));
        h.onToggle(next);
      });
    });

    modalBody.querySelectorAll('.segmented').forEach((group) => {
      const h = handlers[group.id];
      if (!h) return;
      group.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          group.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          h.onPick(btn.dataset.value);
        });
      });
    });
  };

  /* ---------------------------------------------------------- 各弹窗内容 */

  function showRules() {
    openModal({
      title: '游戏规则',
      subtitle: '《并购风云》60 周年纪念版 · 核心流程速览',
      body: `
        <h3>目标</h3>
        <p>游戏结束时，手中 <strong>现金最多</strong> 的玩家获胜。现金只来自两处：并购时的股东分红，以及终局把股票卖给银行。</p>
        <div class="kv">
          <div><b>$6,000</b><span>起始现金</span></div>
          <div><b>6 块</b><span>起始手牌</span></div>
          <div><b>12 × 9</b><span>棋盘规模</span></div>
          <div><b>25 张</b><span>每家股票</span></div>
        </div>

        <h3>回合流程</h3>
        <ul>
          <li><strong>① 放置板块</strong>：孤立放置 / 创立公司 / 扩张公司 / 触发并购。</li>
          <li><strong>② 购买股票</strong>：最多 3 张，可集中可分散，不能主动卖出。</li>
          <li><strong>③ 补牌</strong>：补回 6 块，回合结束。</li>
        </ul>

        <h3>并购结算</h3>
        <ul>
          <li>比较规模定存亡，<strong>触发板块本身不计入任何一方</strong>；平局由触发者决定。</li>
          <li>被吞并公司按持股数排出前几名，按股价倍数发放分红。</li>
          <li>持股者从触发者起顺时针，<strong>逐张</strong>选择：套现 / 2 换 1 / 保留。</li>
          <li>被吞并公司的板块并入存活公司，总部收回托盘。</li>
        </ul>

        <h3>分红倍数</h3>
        <ul>
          <li>经典模式：第一名 <strong>×10</strong>，第二名 <strong>×5</strong>，其余无。</li>
          <li>大亨模式：第一名 ×10、第二名 ×5，<strong>第三名亦分红</strong>。</li>
        </ul>

        <h3>关键边界</h3>
        <ul>
          <li><strong>11 块</strong>即进入安全状态，不可被吞并。</li>
          <li>无法合法放置的板块可直接弃掉（每回合一次）。</li>
          <li>任意公司达 <strong>41 块</strong>，或所有存活公司均达 11 块，游戏立即结束。</li>
        </ul>

      `,
      actions: [{ label: '知道了', className: 'btn--gold' }],
    });
  }

  /* ------------------------------------------------------ 公司名称编辑器 */

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function companyEditorHTML() {
    const list = (window.AcquireCompanies && window.AcquireCompanies()) || [];
    if (!list.length) return '';

    const overrides = settings.companyNames || {};
    const tierNames = ['小规模', '中规模', '大规模'];

    return [0, 1, 2].map((tier) => {
      const items = list.filter((c) => c.tier === tier);
      if (!items.length) return '';

      const rows = items.map((c) => {
        const o = overrides[c.id] || {};
        return `
          <div class="name-row">
            <input class="text-input text-input--mark" data-id="${c.id}" data-field="mark"
                   style="--c:${c.color}" maxlength="2"
                   value="${escapeAttr(o.mark || c.mark)}"
                   aria-label="${escapeAttr(c.name)} 缩写">
            <input class="text-input" data-id="${c.id}" data-field="name" maxlength="8"
                   value="${escapeAttr(o.name || c.name)}"
                   aria-label="${escapeAttr(c.name)} 名称">
          </div>`;
      }).join('');

      return `
        <div class="name-group">
          <div class="name-group-label"><i></i><span>${tierNames[tier]}</span><i></i></div>
          ${rows}
        </div>`;
    }).join('');
  }

  function readCompanyEditor() {
    const map = {};
    document.querySelectorAll('#modalBody .text-input').forEach((el) => {
      const id = el.dataset.id;
      if (!id) return;
      map[id] = map[id] || {};
      map[id][el.dataset.field] = el.value.trim();
    });
    return map;
  }

  function bindVolumeSlider() {
    setTimeout(() => {
      const el = document.getElementById('volumeSlider');
      if (!el) return;
      let lastStep = Math.round(Number(el.value) / 5);

      el.addEventListener('input', () => {
        const v = Number(el.value) / 100;
        settings.volume = v;
        if (window.Sfx) {
          window.Sfx.setVolume(v);
          const step = Math.round(Number(el.value) / 5);
          if (step !== lastStep) {
            lastStep = step;
            window.Sfx.play('tick');
          }
        }
      });

      el.addEventListener('change', () => {
        settings.sound = Number(el.value) > 0;
        saveSettings();
        applySound();
      });
    }, 0);
  }

  function showSettings() {
    bindVolumeSlider();

    openModal({
      title: '设置',
      subtitle: '偏好保存在本地，下次自动生效',
      body: `
        ${switchRow('界面动效', '背景浮动与转场动画', settings.motion, (v) => {
          settings.motion = v;
          saveSettings();
          applyMotion();
        })}
        ${switchRow('音效', '操作与结算提示音', settings.sound, (v) => {
          settings.sound = v;
          saveSettings();
          applySound();
          if (v && window.Sfx) window.Sfx.play('select');
        })}

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">音量</span>
            <span class="setting-note">拖动时会有咔哒声，方便试听</span>
          </div>
          <input class="volume-slider" id="volumeSlider" type="range"
                 min="0" max="100" step="5" value="${Math.round((settings.volume ?? 1) * 100)}">
        </div>

        ${segmentedRow(
          '悬停响应时间',
          '鼠标停住多久才弹出提示框',
          [
            { value: 'fast', label: '快 0.15s' },
            { value: 'normal', label: '标准 0.3s' },
            { value: 'slow', label: '慢 0.6s' },
          ],
          settings.hoverDelay || 'normal',
          (v) => {
            settings.hoverDelay = v;
            saveSettings();
            if (window.Tooltip) window.Tooltip.setDelay(hoverDelayMs(settings.hoverDelay));
          }
        )}

        ${segmentedRow(
          '操作等待时间',
          '每个阶段给你多久思考；超时后系统会随机代打',
          [
            { value: 'short', label: '短 20s' },
            { value: 'medium', label: '中 35s' },
            { value: 'long', label: '长 50s' },
          ],
          settings.waitTime || 'medium',
          (v) => {
            settings.waitTime = v;
            saveSettings();
          }
        )}

        <h3>连锁酒店</h3>
        <p class="setting-note" style="margin-bottom:10px">
          可以自定义名称与缩写字母。颜色和价位档是规则的一部分，不能修改。
        </p>
        <div class="name-editor">${companyEditorHTML()}</div>
      `,
      actions: [
        {
          label: '恢复默认',
          className: 'btn--danger',
          onClick: () => {
            settings = Object.assign({}, DEFAULTS);
            saveSettings();
            applyMotion();
            applySound();
            if (window.applyCompanyNames) window.applyCompanyNames({});
            toast('已恢复默认设置');
            setTimeout(showSettings, 220);
          },
        },
        {
          label: '打开音效调校台',
          className: 'btn--ghost',
          keepOpen: true,
          onClick: () => {
            window.open('sfx-tuner.html', '_blank');
          },
        },
        {
          label: '完成',
          className: 'btn--gold',
          onClick: () => {
            settings.companyNames = readCompanyEditor();
            saveSettings();
            if (window.applyCompanyNames) window.applyCompanyNames(settings.companyNames);
          },
        },
      ],
    });
  }

  /* --------------------------------------------------------- 生涯与成就 */

  function showCareer() {
    if (!window.Career) return;
    const s = window.Career.summaryForPanel();
    const comps = (window.AcquireGallery && window.AcquireGallery.companies) || [];

    const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');

    const recent = Array.isArray(s.recent) ? s.recent : [];
    const trend = recent.length
      ? recent.map((r, i) => '<i class="trend-bar" style="--h:' + (100 - (r - 1) * 18) + '%"'
      + ' title="第 ' + (i + 1) + ' 局 · 第 ' + r + ' 名"><b>' + r + '</b></i>').join('')
      : '<span class="trend-empty">还没有战绩</span>';

    const cells = [
      ['总对局', s.games],
      ['胜率', s.winRate + '%'],
      ['平均排名', s.avgRank],
      ['生涯累计资产', money(s.cumNet)],
      ['单局最高净资产', money(s.bestNet)],
      ['单次最高分红', money(s.bestDividend)],
      ['累计分红', money(s.cumDividend)],
      ['触发并购', s.cumMergers],
    ].map((x) => '<div class="career-cell"><b>' + x[1] + '</b><span>' + x[0] + '</span></div>').join('');

    const styles = [
      ['套现', s.sellRate],
      ['换股', s.swapRate],
      ['保留', s.keepRate],
    ].map((x) => '<div class="style-row"><span>' + x[0] + '</span><i style="--w:' + x[1] + '"></i><b>' + x[1] + '%</b></div>').join('');

    const favName = (comps.find((c) => c.id === s.favCompany) || { name: '暂无' }).name;

    /* 档位统一用罗马数字，不再用青铜/白银/黄金 */
    const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];
    const tierName = (n) => ROMAN[n - 1] || String(n);

    const unlocked = s.unlocked || {};

    const ach = window.Career.ACHIEVEMENTS.map((def) => {
      const tier = unlocked[def.id] || 0;
      const total = def.tiers.length;
      const cur = tier ? def.tiers[tier - 1] : null;
      const next = tier < total ? def.tiers[tier] : null;

      const pips = Array.from({ length: total }, (_, i) =>
        '<i class="ach-pip' + (i < tier ? ' is-lit' : '') + '"></i>').join('');

      // 介绍与档位挪进悬停提示框，卡片本身只留名字与进度
      return '<div class="ach-card' + (tier ? ' is-on' : '') + '"'
        + ' data-tip="ach" data-id="' + def.id + '">'
        + '<div class="ach-head">'
        +   '<span class="ach-icon">' + (cur ? tierName(tier) : '锁') + '</span>'
        +   '<b>' + def.name + '</b>'
        + '</div>'
        + '<div class="ach-pips">' + pips + '</div>'
        + '</div>';
    }).join('');

    const section = (title, hint, inner) =>
      '<section class="career-section">'
      + '<header class="career-section-head"><h3>' + title + '</h3>'
      + (hint ? '<span>' + hint + '</span>' : '') + '</header>'
      + '<div class="career-section-body">' + inner + '</div>'
      + '</section>';

    const body = [
      section('商业画像', '生涯累计数据', '<div class="career-grid">' + cells + '</div>'),
      section('操盘风格', '被吞并股票的处置比例',
        styles + '<p class="career-fav">最爱买：<b>' + favName + '</b></p>'),
      section('最近 20 局排名', '1 = 冠军',
    '<div class="trend' + (recent.length > 8 ? ' is-dense' : '') + '">' + trend + '</div>'),
      section('成就殿堂', '共 ' + window.Career.ACHIEVEMENTS.length + ' 项',
        '<div class="ach-grid">' + ach + '</div>'),
    ].join('');

    openModal({
      title: '生涯与成就',
      subtitle: '数据只存在本机，不会上传',
      body,
      actions: [
        {
          label: '清空生涯数据',
          className: 'btn--danger',
          onClick: () => {
            if (!window.confirm('确定清空全部生涯与成就数据？此操作不可恢复。')) return;
            window.Career.resetAll();
            toast('生涯数据已清空');
          },
        },
        { label: '关闭', className: 'btn--ghost' },
      ],
    });
  }

  /**
   * 历史战绩卡片。
   * 名次配色按需求：第一绿、倒数第一红、其余白。
   */
  function replayCards() {
    const list = window.Career.replays ? window.Career.replays() : [];
    if (!list.length) {
      return '<p class="replay-empty">还没有对局记录 —— 打完一局就会出现在这里。</p>';
    }

    return '<div class="replay-list">' + list.map((r) => {
      const d = new Date(r.at);
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

      const myRanks = (r.humans || []).map((i) => {
        const order = r.ranks || [];
        const pos = order.indexOf(i);
        return pos < 0 ? 0 : pos + 1;
      });
      const best = myRanks.length ? Math.min.apply(null, myRanks) : 0;
      const total = (r.names || []).length;

      let cls = 'is-mid';
      if (best === 1) cls = 'is-first';
      else if (best === total) cls = 'is-last';

      return '<button class="replay-card ' + cls + '" data-replay="' + r.id + '">'
        + '<span class="replay-card-mode">' + (r.mode === 'tycoon' ? '大亨' : '经典') + '</span>'
        + '<span class="replay-card-time">' + stamp + '</span>'
        + '<span class="replay-card-rank">第 ' + best + ' 名</span>'
        + '<span class="replay-card-rounds">' + (r.frames ? r.frames.length : 0) + ' 回合</span>'
        + '</button>';
    }).join('') + '</div>';
  }

  // 详情页「返回」要回到这份列表，而不是主菜单
  window.showHistoryList = showHistoryList;

  /** 历史战绩列表：主菜单入口，点卡片进详情页 */
  function showHistoryList() {
    openModal({
      title: '历史战绩',
      subtitle: '最近 10 局 · 点击任意一局查看详情',
      body: replayCards(),
      actions: [{ label: '关闭', className: 'btn--ghost' }],
    });
  }

  /** 结算时的成就播报 */
  function showAchievementResult(newly) {
    if (!newly || !newly.length) return;
    const rows = newly.map((a) =>
      '<div class="ach-row"><span class="ach-tier">' + a.tier + '</span><b>' + a.name + '</b></div>'
    ).join('');

    setTimeout(function () {
      openModal({
        title: '成就解锁',
        subtitle: '本局的生涯进度已写入',
        body: '<div class="ach-list">' + rows + '</div>',
        actions: [{ label: '好', className: 'btn--gold' }],
      });
    }, 700);
  }

  window.showAchievementResult = showAchievementResult;

  function showAbout() {
    const group = (title, rows) =>
      '<div class="credit-group">'
      + '<h4>' + title + '</h4>'
      + rows.map((r) => '<div class="credit-row"><b>' + r[0] + '</b><span>' + r[1] + '</span></div>').join('')
      + '</div>';

    const thanks = (name, note) =>
      '<p class="thanks-item"><b>' + name + '</b><span>' + note + '</span></p>';

    openModal({
      title: '关于',
      subtitle: '并购风云 · ACQUIRE 60 周年纪念版',
      body: `
        <h3>版本信息</h3>
        <div class="kv">
          <div><b>v${VERSION}</b><span>正式版</span></div>
          <div><b>2–6 人</b><span>支持人数</span></div>
          <div><b>热座与 AI</b><span>可混合对局</span></div>
        </div>

        <h3>游戏说明</h3>
        <p>基于《Acquire》60 周年纪念版规则打造的同人程序。
        完整还原放置板块、创立公司、并购结算、股票交易与终局排名流程。
        支持本地热座，未选中的席位由具备独立决策逻辑的 AI 接管。</p>
        <p>规则依据项目内《规则书》，股价与分红表严格按实体「股东信息卡」录入。</p>

        <h3>制作名单</h3>
        ${group('核心企划', [
          ['主创策划', '路鸿轩'],
          ['游戏设计', '路鸿轩'],
          ['项目管理', '路鸿轩'],
          ['规则整理', '路鸿轩'],
        ])}
        ${group('程序与工程', [
          ['系统架构', '路鸿轩'],
          ['核心程序开发', '路鸿轩 &amp; DeepSeek AI 结对编程'],
          ['前端开发', '路鸿轩'],
          ['界面实现', '路鸿轩'],
          ['事件状态机设计', '路鸿轩'],
          ['存档系统开发', '路鸿轩'],
        ])}
        ${group('视觉与体验', [
          ['视觉统筹', '路鸿轩'],
          ['美术监修', '路鸿轩'],
          ['交互设计', '路鸿轩'],
          ['动效设计', '路鸿轩'],
          ['音效调试', '路鸿轩'],
          ['文案包装', '路鸿轩'],
        ])}
        ${group('算法与 AI', [
          ['AI 行为树架构', '路鸿轩'],
          ['算法逻辑顾问', 'DeepSeek Harness'],
          ['模型支持', 'DeepSeek V4.1 Flash 1017'],
          ['代码审查优化', 'DeepSeek AI 助手'],
        ])}
        ${group('测试与打磨', [
          ['规则校对', '路鸿轩 &amp; 抖音“桌游的神”'],
          ['边界情况测试', '路鸿轩'],
          ['数值平衡体验', '路鸿轩'],
        ])}

        <h3>特别鸣谢</h3>
        ${thanks('Sid Sackson', '致敬《Acquire》原版设计师，伟大的机制跨越了时间。')}
        ${thanks('Hasbro &amp; Avalon Hill', '感谢 60 周年纪念版实体桌游发行商提供的规则与灵感。')}
        ${thanks('抖音“桌游的神”', '感谢 up 硬核桌游文化推广。')}
        ${thanks('DeepSeek', '可靠的 AI 开发伙伴与代码助手。')}

        <h3>规则来源与声明</h3>
        <p>规则整理自《Acquire》60 周年纪念版实体桌游官方规则书与实体「股东信息卡」，
        并结合实际对局中的边界情形（安全公司吞并、零散板块连带、股票逐张处置等）做了详尽补充说明。</p>
        <p>本项目为非商业性质的同人实现。</p>
      `,
      actions: [{ label: '关闭', className: 'btn--ghost' }],
    });
  }

  /* -------------------------------------------------------- 对局配置弹窗 */

  function showSetup() {
    // 用一份临时副本，取消则不落地
    const draft = {
      players: String(settings.players),
      mode: settings.mode,
      openInfo: settings.openInfo,
      aiDifficulty: settings.aiDifficulty || 'normal',
      // 你操控的角色（0 基下标），其余交给 AI
      humans: normalizeHumans(settings.humans, Number(settings.players)),
    };

    // 是否真的有 AI 参战：全部角色都被你选中时，难度这一行就没意义
    const hasAi = () =>
      draft.humans.filter((i) => i < Number(draft.players)).length < Number(draft.players);
    // 0 人 → 全是 AI，难度行照常显示

    const syncAiRow = () => {
      const row = document.getElementById('aiDiffRow');
      if (row) row.style.display = hasAi() ? '' : 'none';
    };

    const chipsHTML = (total, selected) => Array.from({ length: total }, (_, i) => `
      <button data-p="${i}" class="${selected.indexOf(i) >= 0 ? 'is-on' : ''}">玩家 ${i + 1}</button>
    `).join('');

    const body = `
      ${segmentedRow(
        '玩家人数',
        '2 人节奏最快，5–6 人更混乱',
        [2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} 人` })),
        draft.players,
        (v) => { draft.players = v; }
      )}
      <div class="setting-row setting-row--top">
        <div class="setting-info">
          <span class="setting-name">你操控的角色</span>
          <span class="setting-note">未选中的角色由 AI 接管</span>
        </div>
        <div class="chip-group" id="humanChips">
          ${chipsHTML(Number(draft.players), draft.humans)}
        </div>
      </div>
      ${segmentedRow(
        '游戏模式',
        '大亨模式让第三名也能分红',
        [
          { value: 'classic', label: '经典' },
          { value: 'tycoon', label: '大亨' },
        ],
        draft.mode,
        (v) => { draft.mode = v; }
      )}
      <div id="aiDiffRow">
        ${segmentedRow(
          'AI 难度',
          '简单＝只会乱买；普通＝会算分红与控股；困难＝会做局、抢分红、卡终局',
          [
            { value: 'easy', label: '简单' },
            { value: 'normal', label: '普通' },
            { value: 'hard', label: '困难' },
          ],
          draft.aiDifficulty,
          (v) => { draft.aiDifficulty = v; }
        )}
      </div>
      ${switchRow('信息公开', '现金与持股对所有人可见', draft.openInfo, (v) => {
        draft.openInfo = v;
      })}
    `;

    openModal({
      title: '新的对局',
      subtitle: '配置本局规则，随后进入游戏桌面',
      body,
      actions: [
        {
          label: '开始游戏',
          className: 'btn--gold',
          onClick: () => {
            const total = Number(draft.players);

            settings.players = total;
            /*
             * 允许一个都不选 —— 那就是「全员 AI」观战局。
             * 以前这里会强行塞回 [0]，等于永远没有纯观战。
             */
            settings.humans = draft.humans.filter((i) => i < total);
            settings.mode = draft.mode;
            settings.openInfo = draft.openInfo;
            settings.aiDifficulty = draft.aiDifficulty;
            saveSettings();

            if (typeof window.startGame === 'function') {
              window.startGame(settings);
            } else {
              showScreen('game');
            }
          },
        },
        { label: '取消', className: 'btn--ghost' },
      ],
    });

    syncAiRow();

    const bodyEl = document.getElementById('modalBody');
    if (bodyEl) {
      bodyEl.addEventListener('click', (e) => {
        // 角色 chip 多选
        const chip = e.target.closest('.chip-group button');
        if (chip) {
          const idx = Number(chip.dataset.p);
          const pos = draft.humans.indexOf(idx);

          if (pos >= 0) {
            // 允许把最后一个也取消 —— 全 AI 观战
            draft.humans.splice(pos, 1);
          } else {
            draft.humans.push(idx);
            draft.humans.sort((a, b) => a - b);
          }
          chip.classList.toggle('is-on', draft.humans.indexOf(idx) >= 0);
          syncAiRow();
          return;
        }

        // 改玩家人数：重建角色 chip
        if (e.target.closest('.segmented button')) {
          setTimeout(() => {
            const total = Number(draft.players);
            draft.humans = draft.humans.filter((i) => i < total);

            const group = document.getElementById('humanChips');
            if (group) group.innerHTML = chipsHTML(total, draft.humans);
            syncAiRow();
          }, 0);
        }
      });
    }
  }

  /** 规范成 { 0..total-1 } 里的下标数组，至少一个 */
  function normalizeHumans(value, total) {
    const out = Array.isArray(value)
      ? value.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < total)
      : [];
    const uniq = Array.from(new Set(out)).sort((a, b) => a - b);
    return uniq.length ? uniq : [0];
  }

  /* --------------------------------------------------------------- 艺术画廊 */

  let galleryData = null;
  let artOpen = null;      // 当前被取下的画框

  const GALLERY_GAP = 460; // 画与画之间的间隔 = 一个画框的宽度

  function renderGallery() {
    const wall = document.getElementById('galleryWall');
    const stage = document.getElementById('galleryStage');
    if (!wall || !stage || !window.AcquireGallery) return;

    // 每次进入这个界面都回到最左（标题居中的位置）
    if (stage._galleryReset) stage._galleryReset();

    if (wall.childElementCount) return;   // DOM 只渲染一次

    const { certHTML, companies } = window.AcquireGallery;
    const counts = [3, 2, 5, 4, 6, 2, 1];
    galleryData = { certHTML, companies, counts };

    /*
     * 标题作为墙上的「第一件东西」，这样滚轮滑动时
     * 墙、画、标题是一起动的，像一整个展厅平移过去。
     */
    const head = `
      <div class="gallery-title" aria-hidden="true">
        <span class="gallery-rule"></span>
        <h1>艺术画廊</h1>
        <p>证 券 陈 列 室 · 6 0 周 年 纪 念 版</p>
        <span class="gallery-rule"></span>
      </div>`;

    const pieces = companies.map((c, i) => `
      <figure class="gallery-piece" data-i="${i}" style="--c:${c.color}" title="点击取下细看">
        <div class="gallery-frame">
          <div class="gallery-cert">${certHTML(c, counts[i] || 1)}</div>
        </div>
        <figcaption class="gallery-caption">
          <span class="gallery-no">${String(i + 1).padStart(2, '0')}</span>
          <span class="gallery-name">${c.name}</span>
          <span class="gallery-tier">${['小型', '中型', '大型'][c.tier]}</span>
        </figcaption>
      </figure>`).join('');

    wall.style.setProperty('--gap', GALLERY_GAP + 'px');
    wall.innerHTML = head + pieces;

    /* ---------------- 滚轮 / 拖动 / 惯性 / 吸附 ---------------- */
    /*
     * 不再直接改 scrollLeft（那会一跳一跳），
     * 而是维护一个「目标位置」，每帧用插值逼近它 —— 无论滚轮多密都平滑。
     */
    let targetX = stage.scrollLeft;
    let ticking = false;
    let dragging = false;
    let dragMoved = false;
    let startX = 0;
    let startLeft = 0;

    const maxScroll = () => Math.max(0, stage.scrollWidth - stage.clientWidth);
    const clampX = (x) => Math.max(0, Math.min(maxScroll(), x));

    /**
     * 吸附点：
     *   0 —— 标题居中的那一屏（最左）
     *   每幅画的中心对齐舞台中央
     * 不把 0 算进去的话，从标题屏稍微滚一下就会被吸到第一幅画，像"跳"过去。
     */
    const snapTargets = () => {
      const list = [0];
      Array.from(wall.querySelectorAll('.gallery-piece')).forEach((el) => {
        list.push(clampX(el.offsetLeft + el.offsetWidth / 2 - stage.clientWidth / 2));
      });
      return list;
    };

    const nearestSnap = () => {
      const targets = snapTargets();
      if (!targets.length) return stage.scrollLeft;
      let best = targets[0];
      let bestD = Infinity;
      targets.forEach((t) => {
        const d = Math.abs(t - stage.scrollLeft);
        if (d < bestD) { bestD = d; best = t; }
      });
      return clampX(best);
    };

    const tick = () => {
      const cur = stage.scrollLeft;
      const diff = targetX - cur;

      if (Math.abs(diff) < 0.6) {
        stage.scrollLeft = targetX;
        ticking = false;
        if (!dragging) targetX = nearestSnap();   // 停稳后吸附
        return;
      }

      // 0.14 的插值系数：有惯性感，又不会拖泥带水
      stage.scrollLeft = cur + diff * 0.14;
      requestAnimationFrame(tick);
    };

    const pushTo = (delta) => {
      targetX = clampX(targetX + delta);
      if (!ticking) { ticking = true; requestAnimationFrame(tick); }
    };

    /** 复位到最左：标题居中的初始视角 */
    stage._galleryReset = () => {
      ticking = false;
      dragging = false;
      targetX = 0;
      stage.scrollLeft = 0;
    };

    stage.addEventListener('wheel', (e) => {
      if (artOpen) return;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!d) return;
      e.preventDefault();
      pushTo(Math.max(-160, Math.min(160, d)) * 0.55);
    }, { passive: false });

    /* 拖动：不捕获指针，否则 click 会被 stage 吃掉（点了画画打不开） */
    stage.addEventListener('pointerdown', (e) => {
      if (artOpen || e.button !== 0) return;
      dragging = true;
      dragMoved = false;
      startX = e.clientX;
      startLeft = stage.scrollLeft;
      targetX = stage.scrollLeft;
      ticking = false;
    });

    stage.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (!dragMoved && Math.abs(dx) > 6) dragMoved = true;
      if (!dragMoved) return;
      stage.scrollLeft = clampX(startLeft - dx);
      targetX = stage.scrollLeft;
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (dragMoved) {
        targetX = nearestSnap();
        if (!ticking) { ticking = true; requestAnimationFrame(tick); }
      }
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    /* ---------------- 取下 / 放回 ---------------- */
    wall.addEventListener('click', (e) => {
      const piece = e.target.closest('.gallery-piece');
      if (!piece) return;
      takeDownArt(Number(piece.dataset.i), piece);
    });

    const veil = document.getElementById('artVeil');
    if (veil) veil.addEventListener('click', putBackArt);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && artOpen) putBackArt();
    });
  }

  /**
   * 取下画框：从它在墙上的位置飞出来、放大到屏幕中央。
   */
  function takeDownArt(idx, piece) {
    if (artOpen) return;
    const c = galleryData && galleryData.companies[idx];
    const veil = document.getElementById('artVeil');
    const inner = document.getElementById('artVeilInner');
    if (!c || !veil || !inner) return;

    const src = piece.querySelector('.gallery-cert');
    const from = (src || piece).getBoundingClientRect();

    inner.innerHTML = '<div class="art-veil-frame" style="--c:' + c.color + '">'
      + '<div class="art-veil-cert">' + galleryData.certHTML(c, galleryData.counts[idx] || 1) + '</div>'
      + '<div class="art-veil-caption">'
      + '<span>' + String(idx + 1).padStart(2, '0') + '</span>'
      + '<b>' + c.name + '</b>'
      + '<em>' + ['小型', '中型', '大型'][c.tier] + '</em>'
      + '</div></div>';

    veil.hidden = false;
    artOpen = { idx: idx, rect: from };

    const frame = inner.firstElementChild;
    const to = frame.getBoundingClientRect();
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);

    frame.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
    frame.style.opacity = '0.4';

    requestAnimationFrame(() => {
      frame.style.transition = 'transform 0.5s cubic-bezier(0.22,1,0.36,1), opacity 0.35s ease';
      frame.style.transform = 'translate(0,0) scale(1,1)';
      frame.style.opacity = '1';
    });

    if (window.Sfx) window.Sfx.play('select');
  }

  function putBackArt() {
    if (!artOpen) return;
    const veil = document.getElementById('artVeil');
    const inner = document.getElementById('artVeilInner');
    const frame = inner && inner.firstElementChild;
    const info = artOpen;
    artOpen = null;

    if (!frame || !veil) return;

    const target = document.querySelector('.gallery-piece[data-i="' + info.idx + '"] .gallery-cert')
      || document.querySelector('.gallery-piece[data-i="' + info.idx + '"]');
    const back = target ? target.getBoundingClientRect() : info.rect;
    const to = frame.getBoundingClientRect();

    const sx = back.width / to.width;
    const sy = back.height / to.height;
    const dx = (back.left + back.width / 2) - (to.left + to.width / 2);
    const dy = (back.top + back.height / 2) - (to.top + to.height / 2);

    frame.style.transition = 'transform 0.42s cubic-bezier(0.4,0,0.7,1), opacity 0.42s ease';
    frame.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
    frame.style.opacity = '0';

    setTimeout(() => {
      veil.hidden = true;
      inner.innerHTML = '';
    }, 440);

    if (window.Sfx) window.Sfx.play('ui');
  }

  /* ----------------------------------------------------------- 应用设置 */

  /** 悬停响应档位 → 毫秒 */
  function hoverDelayMs(v) {
    if (v === 'fast') return 150;
    if (v === 'slow') return 600;
    return 300;
  }

  /**
   * 悬停提示框：注册「成就」这一种内容，其余内容由 board.js 注册。
   * 只在这里安装一次，之后由 Tooltip 自己接管鼠标事件。
   */
  function setupTooltip() {
    if (!window.Tooltip) return;
    window.Tooltip.setDelay(hoverDelayMs(settings.hoverDelay));
    window.Tooltip.install();

    window.Tooltip.register('ach', (el) => {
      const def = window.Career.ACHIEVEMENTS.filter((a) => a.id === el.dataset.id)[0];
      if (!def) return null;

      const unlocked = window.Career.summaryForPanel().unlocked || {};
      const tier = unlocked[def.id] || 0;
      const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ'];

      const tiers = def.tiers.map((t, i) => {
        const on = i < tier;
        const label = typeof t.v === 'number'
          ? (t.v + (t.unit || ''))
          : String(t.v);
        return '<li class="' + (on ? 'is-on' : '') + '">'
          + '<span>' + ROMAN[i] + '</span><span>' + label + '</span></li>';
      }).join('');

      // 用真实进度代替「已达成最高档」这种笼统说法
      const progress = window.Career.progressOf ? window.Career.progressOf(def.id) : '';

      return {
        title: def.name + (tier ? '　' + ROMAN[tier - 1] + ' 阶' : '　未解锁'),
        html: def.desc + '<ul class="tip-tiers">' + tiers + '</ul>',
        meta: progress,
      };
    });
  }

  function applyMotion() {
    document.body.classList.toggle('no-motion', !settings.motion);
    if (settings.motion) renderFloatingTiles();
  }

  function applySound() {
    if (!window.Sfx) return;
    window.Sfx.setEnabled(settings.sound);
    window.Sfx.setVolume(settings.volume == null ? 1 : settings.volume);
  }



  /* --------------------------------------------------------------- 屏幕切换 */

  function showScreen(name) {
    const menu = document.getElementById('screenMenu');
    const game = document.getElementById('screenGame');
    const gallery = document.getElementById('screenGallery');
    const history = document.getElementById('screenHistory');
    if (!menu || !game) return;

    const isGame = name === 'game';
    const isGallery = name === 'gallery';
    const isHistory = name === 'history';

    menu.hidden = isGame || isGallery || isHistory;
    game.hidden = !isGame;
    if (gallery) gallery.hidden = !isGallery;
    if (history) history.hidden = !isHistory;
    document.body.classList.toggle('is-game', isGame);
    document.body.classList.toggle('is-gallery', isGallery);
    document.body.classList.toggle('is-history', isHistory);

    // 离开牌桌就把整局挂起：停计时、停 AI、停声音
    if (!isGame && window.suspendGame) window.suspendGame();

    if (isGallery) renderGallery();

    // 关掉可能残留的弹窗，并清掉向导遗留的锁
    modalLocked = false;
    if (modalClose) modalClose.style.visibility = '';
    if (!overlay.hidden) closeModal();

    // 切回主菜单时，品牌区（标题 / 副标题 / 徽章）重播一次渐显。
    // 它们已经改成 transition 实现，display 从 none 切回来不会自动重播；
    // 开屏进行中则跳过，交给 playIntro 的收尾去播。
    if (name === 'menu' && !document.documentElement.classList.contains('is-intro')) {
      revealBrand();
    }

    window.scrollTo(0, 0);
  }

  /** 任何按钮都有点击音（手牌自己带音效，避免叠音） */
  function bindClickSound() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('button');
      if (!el || el.disabled) return;
      if (el.classList.contains('hand-tile')) return;
      if (window.Sfx) window.Sfx.play('ui');
    });
  }

  /* --------------------------------------------------------------- 绑定 */

  function bindMenu() {
    const back = document.getElementById('galleryBack');
    if (back) back.addEventListener('click', () => showScreen('menu'));

    $('#menu').addEventListener('click', (e) => {
      const btn = e.target.closest('.menu-btn');
      if (!btn) return;

      switch (btn.dataset.action) {
        case 'start':    showSetup();   break;
        case 'rules':    showRules();   break;
        case 'gallery':  showScreen('gallery'); break;
        case 'career':   showCareer();   break;
        case 'history':  showHistoryList(); break;
        case 'settings': showSettings(); break;
        case 'about':    showAbout();   break;
      }
    });
  }

  /* ----------------------------------------------------------- 对外接口 */

  /** 弹窗是否正在展示（展开或收纳都算）——游戏侧用它做硬锁 */
  function isModalOpen() {
    return overlay && !overlay.hidden;
  }

  window.Acquire = {
    showScreen: showScreen,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    lockModal: lockModal,
    isModalOpen: isModalOpen,
    showRules: showRules,
    getSettings: () => Object.assign({}, settings),
  };

  /* --------------------------------------------------------------- 启动 */

  /**
   * 主菜单品牌区三行（标题 / 副标题 / 徽章）的逐个渐显。
   *
   * 两处会调用它：
   *   1. 开屏收尾时（playIntro 的 land）；
   *   2. 从别的界面切回主菜单时（showScreen）。
   *
   * 为什么不用 CSS 动画：这几个元素在开屏期间被
   * `.is-intro ... !important { animation: none }` 关掉，撤掉那个类时 Chromium
   * 不会让动画「从头再播一次」，只会直接落到终态 —— 标题于是永远瞬间出现。
   * 另外 display 从 none 切回 block 也不会让 transition 重播，必须显式重置初值，
   * 所以切回主菜单时也要再调一次这里。
   */
  function revealBrand() {
    const rows = [
      [document.querySelector('.brand-title'), 0],
      [document.querySelector('.brand-sub'), 90],
      [document.querySelector('.brand-badge'), 180]
    ].filter((r) => r[0]);
    if (!rows.length) return;

    rows.forEach(([el, delay]) => {
      el.classList.add('ui-reveal');
      el.style.transitionDelay = delay + 'ms';
      el.style.opacity = '0';
      el.style.transform = 'translateY(14px)';
    });

    // 两帧之后再改成终态，保证浏览器先采纳上面的初始值，过渡才会真的发生
    requestAnimationFrame(() => requestAnimationFrame(() => {
      rows.forEach(([el]) => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
    }));
  }

  /* ------------------------------------------------------------ 开屏动画 */

  /*
   * 只在页面首次加载时播一次；从游戏返回主菜单不重播。
   * 首帧的隐藏状态由 index.html <head> 里的小段内联脚本先置位，
   * 所以这里不存在“先显示再隐藏”，也就不会闪。
   *
   * 三条硬约束（都是踩过的坑，别改）：
   *   1. Logo 全程是主菜单那一个 .brand-mark，不新建第二个；
   *   2. 任何出现/消失都走 opacity / transform，绝不改 display、绝不换场景；
   *   3. 归位用 Web Animations 显式写起止帧，不要退回 CSS transition
   *      （同帧改 position/宽度时，transition 会丢掉 scale，只剩位移在动）。
   */
  function playIntro() {
    const html = document.documentElement;
    const mark = document.querySelector('.brand-mark');

    /** 收尾：只清内联、只撤不会产生可见变化的类 */
    function strip() {
      if (mark) {
        mark.style.transform = '';
        mark.style.transformOrigin = '';
        mark.classList.add('settled');   // 永久禁掉 markIn，避免它再播一遍
      }
      html.classList.remove('is-intro', 'intro-center', 'intro-draw', 'is-dim');
    }

    // 没置位（#game 直达 / 兜底已清）或找不到 Logo：直接收尾
    if (!html.classList.contains('is-intro') || !mark) { strip(); showHalo(); return; }
    // 设置里关了动效：不演，直接给菜单
    if (!settings.motion) { strip(); showHalo(); return; }

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 系统要求减少动效时**不跳过**，只把时长压到 35%（跳过会让人以为开屏坏了）
    const k = reduce ? 0.35 : 1;
    html.style.setProperty('--intro-k', String(k));
    const at = (ms, fn) => setTimeout(fn, Math.round(ms * k));

    /*
     * 归位的缓动要「均匀」而不是「前倾」。
     * cubic-bezier(0.22,1,0.36,1) 那种曲线前 25% 的时间就走完 80% 的位移，
     * 眼睛看到的就是“啪一下变小、再慢慢挪过去”。这里用更接近匀速的曲线。
     */
    const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
    const retMs = Math.round(1050 * k);

    /**
     * 品牌区背后的放射光晕（.brand::after）淡入。
     * 伪元素写不了内联样式，所以在 .brand 上加一个类，由 CSS 的 transition 淡入 ——
     * 机制和上面的 revealBrand() 一样，不是另一套手法。
     */
    function showHalo() {
      const brand = document.querySelector('.brand');
      if (brand) brand.classList.add('halo-in');
    }

    let landed = false;
    let returnAnim = null;
    function land() {
      if (landed) return;
      landed = true;
      if (returnAnim) { returnAnim.cancel(); returnAnim = null; }
      strip();
      // 品牌区用内联 transition 渐显；光晕由 .brand.halo-in 触发 CSS transition 淡入
      revealBrand();
      showHalo();
    }

    /*
     * 开屏只有两件事：Logo 描边生长 + 背景压暗后浮起。
     * 不加光晕、不加放射光、不加粒子 —— 制作人 2026-11-04 明确要求，
     * 想加特效先问他。之前那个 drop-shadow 光晕就是在这里被删掉的。
     */

    // 1）描边生长（外框先，内框错峰 300ms）
    at(160, () => html.classList.add('intro-draw'));

    // 2）背景从黑里浮起来（与描边尾段重叠）
    at(520, () => html.classList.remove('is-dim'));

    // 3）描边结束 → Logo 缩小归位
    at(160 + 900 + 300 + 60, () => {
      /*
       * 归位用 Web Animations 显式写起止帧，不用 CSS transition。
       * 这里要同时把「fixed + 26vmin」换回「常规流 + 54px」，位置和尺寸在同一帧突变；
       * 交给 CSS transition 时 Chromium 会把 scale 丢掉、只让位移过渡，
       * 看起来就是“先瞬间变小、再慢慢滑过去”（实测就是这个症状）。
       * 显式给 from / to 就没有这个合并问题。
       */
      const first = mark.getBoundingClientRect();     // 居中放大时的样子
      html.classList.remove('intro-center');          // 立刻回到常规流（54px）
      const last = mark.getBoundingClientRect();      // 品牌位上的样子
      if (!first.width || !last.width || !last.height) { land(); return; }

      const s = first.width / last.width;
      mark.style.transformOrigin = '0 0';             // 原点挪到左上角，位移与缩放才好对齐

      returnAnim = mark.animate(
        [
          {
            transform: 'translate(' + (first.left - last.left) + 'px,' +
                       (first.top - last.top) + 'px) scale(' + s + ')'
          },
          { transform: 'none' }
        ],
        { duration: retMs, easing: ease, fill: 'forwards' }
      );
      returnAnim.addEventListener('finish', land);
      // 双保险：标签页后台被节流时，按时间也要收尾
      setTimeout(land, retMs + 300);
    });

    // 4）兜底：上面什么都没发生也照样收尾
    setTimeout(land, Math.round(4200 * k) + 600);
  }

  function init() {
    applyMotion();
    applySound();
    renderCompanyDots();
    bindMenu();
    bindClickSound();

    // 应用上次保存的公司自定义名称
    if (window.applyCompanyNames) {
      try { window.applyCompanyNames(settings.companyNames || {}); } catch (e) { /* 忽略 */ }
    }

    // 主菜单底部版本号：与「关于」共用同一个常量
    {
      const el = document.querySelector('.version');
      if (el) el.textContent = 'v' + VERSION;
    }

    // 悬停提示框：全站只安装一次
    setupTooltip();

    // 开屏：放在所有初始化之后，让第一帧的画面已经完全就绪
    playIntro();

    console.log('[acquire] v' + VERSION + ' · 主菜单与棋盘就绪');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();