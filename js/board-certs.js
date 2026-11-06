/* ==========================================================================
   并购风云 · 股票证书绘制

   纯字符串生成：不碰 DOM、不读 state、没有副作用。
   从 board.js 抽出来（重构第一步），逐个函数原样搬运，逻辑零改动。

   对外暴露 window.BoardCerts。
   ========================================================================== */

(function () {
  'use strict';

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.56;
  }

  const BUILDINGS = {
    // 尖顶摩天楼
    saxony: `
      <rect x="48" y="4" width="4" height="14"/>
      <rect x="44" y="18" width="12" height="10"/>
      <rect x="40" y="28" width="20" height="20"/>
      <rect x="36" y="48" width="28" height="24"/>
      <rect x="30" y="72" width="40" height="22"/>
      <rect x="22" y="94" width="56" height="26"/>
      <rect x="14" y="120" width="72" height="30"/>`,

    // 双塔 + 连桥
    tower: `
      <rect x="26" y="34" width="16" height="116"/>
      <rect x="58" y="34" width="16" height="116"/>
      <rect x="42" y="72" width="16" height="7"/>
      <rect x="29" y="24" width="10" height="10"/>
      <rect x="61" y="24" width="10" height="10"/>
      <rect x="46" y="10" width="8" height="14"/>
      <rect x="18" y="126" width="64" height="24"/>`,

    // 拱顶塔楼
    america: `
      <rect x="46" y="8" width="8" height="14"/>
      <path d="M50 20a15 15 0 0 1 15 15H35a15 15 0 0 1 15-15z"/>
      <rect x="34" y="35" width="32" height="14"/>
      <rect x="29" y="49" width="42" height="26"/>
      <rect x="23" y="75" width="54" height="20"/>
      <rect x="15" y="95" width="70" height="55"/>`,

    // 穹顶 + 柱廊
    festival: `
      <rect x="46" y="26" width="8" height="16"/>
      <circle cx="50" cy="52" r="26"/>
      <rect x="24" y="52" width="52" height="14"/>
      <rect x="20" y="66" width="60" height="10"/>
      <rect x="16" y="76" width="68" height="74"/>
      <g opacity="0.28">
        <rect x="24" y="82" width="4" height="62"/>
        <rect x="36" y="82" width="4" height="62"/>
        <rect x="48" y="82" width="4" height="62"/>
        <rect x="60" y="82" width="4" height="62"/>
        <rect x="72" y="82" width="4" height="62"/>
      </g>`,

    // 斜切塔身
    worldwide: `
      <path d="M44 8 L56 8 L66 58 L66 150 L32 150 L32 58 Z"/>
      <rect x="22" y="112" width="56" height="38"/>
      <rect x="26" y="150" width="48" height="0"/>
      <g opacity="0.28">
        <rect x="38" y="62" width="2.5" height="46"/>
        <rect x="46" y="62" width="2.5" height="46"/>
        <rect x="54" y="62" width="2.5" height="46"/>
        <rect x="62" y="62" width="2.5" height="46"/>
      </g>`,

    // 宽体板楼
    continental: `
      <rect x="18" y="46" width="64" height="104"/>
      <rect x="12" y="38" width="76" height="10"/>
      <rect x="8" y="120" width="84" height="30"/>
      <g opacity="0.28">
        <rect x="14" y="58" width="72" height="2"/>
        <rect x="14" y="72" width="72" height="2"/>
        <rect x="14" y="86" width="72" height="2"/>
        <rect x="14" y="100" width="72" height="2"/>
        <rect x="14" y="114" width="72" height="2"/>
      </g>`,

    // 山墙 + 尖塔
    imperial: `
      <rect x="47" y="2" width="6" height="22"/>
      <path d="M34 42 L50 24 L66 42 L66 54 L34 54 Z"/>
      <rect x="30" y="54" width="40" height="34"/>
      <rect x="24" y="88" width="52" height="26"/>
      <rect x="14" y="114" width="72" height="36"/>
      <g opacity="0.3">
        <rect x="38" y="60" width="2.5" height="24"/>
        <rect x="48" y="60" width="2.5" height="24"/>
        <rect x="58" y="60" width="2.5" height="24"/>
      </g>`,
  };

  const BUILDING_FALLBACK = BUILDINGS.saxony;

  /** 每家公司一套：剪影、印章齿数、签名人 */
  const CERT_STYLE = {
    saxony:      { teeth: 18, signer: 'A. Whitmore',  role: 'Secretary' },
    tower:       { teeth: 22, signer: 'E. Lansing',   role: 'Treasurer' },
    america:     { teeth: 26, signer: 'J. P. Hale',   role: 'President' },
    festival:    { teeth: 30, signer: 'M. Rivera',    role: 'Secretary' },
    worldwide:   { teeth: 34, signer: 'K. Osei',      role: 'Treasurer' },
    continental: { teeth: 24, signer: 'R. Delacroix', role: 'President' },
    imperial:    { teeth: 28, signer: 'V. Sorensen',  role: 'Secretary' },
  };

  function buildingSVG(companyId) {
    return `
      <svg class="tower" viewBox="0 0 100 150" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        <g fill="currentColor">${BUILDINGS[companyId] || BUILDING_FALLBACK}</g>
      </svg>`;
  }

  /** 锯齿圆章：实心填充，中间镂空出公司缩写 */
  function sealSVG(mark, variant) {
    const teeth = variant.teeth;
    const pts = [];
    for (let i = 0; i < teeth * 2; i++) {
      const a = (Math.PI * 2 * i) / (teeth * 2) - Math.PI / 2;
      const r = i % 2 === 0 ? 47 : 39;
      pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
    }

    // 内圈用纸色描一道，做出「压在纸上」的层次
    const innerRing = variant.teeth % 3 === 0
      ? '<circle cx="50" cy="50" r="30" fill="none" stroke="#f7f3e7" stroke-width="1.6" stroke-dasharray="2 3" opacity="0.85"/>'
      : '<circle cx="50" cy="50" r="30" fill="none" stroke="#f7f3e7" stroke-width="1.6" opacity="0.85"/>';

    return `
      <svg class="seal" viewBox="0 0 100 100" aria-hidden="true">
        <polygon points="${pts.join(' ')}" fill="currentColor"/>
        ${innerRing}
        <text x="50" y="60" text-anchor="middle" font-size="30" font-weight="700"
              font-family="Georgia, serif" fill="#f7f3e7">${mark}</text>
      </svg>`;
  }

  /**
   * 花边框：外框 + 扇形齿边（一圈半圆凸起），用 evenodd 镂空中间。
   */
  function frameSVG(w, h) {
    const inset = 5;          // 外框距纸边
    const band = 13;          // 色带厚度
    const r = 7.5;            // 扇齿半径

    const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
    const ix = x0 + band, iy = y0 + band, ix2 = x1 - band, iy2 = y1 - band;

    let d = `M ${x0} ${y0} H ${x1} V ${y1} H ${x0} Z`;
    d += ` M ${ix} ${iy}`;

    // 上边向右
    for (let x = ix; x < ix2 - 0.5; x += 2 * r) {
      const e = Math.min(x + 2 * r, ix2);
      d += ` A ${r} ${r} 0 0 1 ${e.toFixed(2)} ${iy}`;
    }
    // 右边向下
    d += ` L ${ix2} ${iy}`;
    for (let y = iy; y < iy2 - 0.5; y += 2 * r) {
      const e = Math.min(y + 2 * r, iy2);
      d += ` A ${r} ${r} 0 0 1 ${ix2} ${e.toFixed(2)}`;
    }
    // 下边向左
    d += ` L ${ix2} ${iy2}`;
    for (let x = ix2; x > ix + 0.5; x -= 2 * r) {
      const e = Math.max(x - 2 * r, ix);
      d += ` A ${r} ${r} 0 0 1 ${e.toFixed(2)} ${iy2}`;
    }
    // 左边向上
    d += ` L ${ix} ${iy2}`;
    for (let y = iy2; y > iy + 0.5; y -= 2 * r) {
      const e = Math.max(y - 2 * r, iy);
      d += ` A ${r} ${r} 0 0 1 ${ix} ${e.toFixed(2)}`;
    }
    d += ' Z';

    // 四角的小圆花
    const corner = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="4.2" fill="currentColor"/>`;

    return `
      <svg class="cert-ornament" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${d}" fill="currentColor" fill-rule="evenodd" opacity="0.92"/>
        <rect x="${x0}" y="${y0}" width="${w - inset * 2}" height="${h - inset * 2}"
              fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
        ${corner(x0 + 3.5, y0 + 2)}
        ${corner(x1 - 3.5, y0 + 2)}
        ${corner(x0 + 3.5, y1 - 2)}
        ${corner(x1 - 3.5, y1 - 2)}
      </svg>`;
  }

  /** 微缩卡：公司徽标 + 名称 + 持股数 */
  function miniCardHTML(c, count) {
    return `
      <div class="stock-card" data-cid="${c.id}" data-tip="hold"
           style="--c:${c.color};--c-line:${hexToRgba(c.color, 0.55)};--c-soft:${hexToRgba(c.color, 0.18)}"
           title="${c.name} · ${count} 张">
        <span class="sc-mark">${c.mark}</span>
        <span class="sc-name">${c.name}</span>
        <span class="sc-count">×${count}</span>
      </div>`;
  }

  /** 放大后看到的完整证书 */
  function fullCertHTML(c, count) {
    const variant = CERT_STYLE[c.id] || { teeth: 24, signer: 'J. Doe', role: 'Secretary' };
    const ribbonInk = isLight(c.color) ? '#1a1408' : '#ffffff';
    const serial = String(count).padStart(4, '0');

    return `
      <div class="cert-frame" style="--c:${c.color};--ribbon-ink:${ribbonInk}">
        <div class="cert-paper">
          ${frameSVG(424, 268)}

          <div class="cert-art">${buildingSVG(c.id)}</div>

          <div class="cert-body">
            <div class="cert-ribbon">${c.name}</div>

            <p class="cert-legal">
              This certifies that the bearer named hereon is the registered owner of
              the number of fully paid and non-assessable shares of capital stock of
              the above corporation, transferable only upon the books of the company
              by the holder in person or by duly authorised attorney.
            </p>

            <div class="cert-lower">
              <div class="cert-sign">
                <span class="sign-name">${variant.signer}</span>
                <span class="sign-line"></span>
                <span class="sign-role">${variant.role}</span>
              </div>
              <div class="cert-seal-wrap">${sealSVG(c.mark, variant)}</div>
            </div>

            <div class="cert-foot">
              <span class="cert-caption">Stock Certificate</span>
              <span class="cert-no">No. ${serial}</span>
            </div>
          </div>

          <span class="cert-count-badge">×${count}</span>
        </div>
      </div>`;
  }

  window.BoardCerts = {
    hexToRgba: hexToRgba,
    isLight: isLight,
    buildingSVG: buildingSVG,
    sealSVG: sealSVG,
    frameSVG: frameSVG,
    miniCardHTML: miniCardHTML,
    fullCertHTML: fullCertHTML,
  };
})();
