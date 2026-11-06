/* ==========================================================================
   最小假 DOM（仅测试用）

   目的：让 board-view-*.js 这些「只画界面」的模块能在 Node 里跑起来。
   不追求完整实现，只覆盖这些模块实际用到的东西：
   createElement / appendChild / remove / classList / textContent /
   innerHTML / style.setProperty / dataset / title / querySelector

   选择器只支持三种：'#id'、'.class'、'tag'。
   ========================================================================== */

'use strict';

const registry = new Map();   // '#id' 或 '.class' → element（测试自己登记）
let idSeed = 0;

function makeClassList(node) {
  const set = new Set();
  return {
    add(...names) { names.forEach((n) => n && set.add(n)); },
    remove(...names) { names.forEach((n) => set.delete(n)); },
    contains(name) { return set.has(name); },
    toggle(name, force) {
      const want = force === undefined ? !set.has(name) : !!force;
      if (want) set.add(name); else set.delete(name);
      return want;
    },
    get value() { return [...set].join(' '); },
    _set: set,
  };
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this._text = '';
    this._html = '';
    this.classList = makeClassList(this);
    this.style = {
      _props: {},
      setProperty(k, v) { this._props[k] = String(v); },
      removeProperty(k) { delete this._props[k]; },
      getPropertyValue(k) { return this._props[k] || ''; },
    };
  }

  /* className 与 classList 同步（模块里两种写法都有） */
  get className() { return this.classList.value; }

  set className(v) {
    this.classList._set.clear();
    String(v || '').split(/\s+/).filter(Boolean).forEach((n) => this.classList.add(n));
  }

  /* 文本与 HTML ------------------------------------------------------ */

  get textContent() {
    if (this.children.length) {
      return this.children.map((c) => c.textContent).join('');
    }
    return this._text;
  }

  set textContent(v) {
    this._text = v === null || v === undefined ? '' : String(v);
    this.children = [];
    this._html = '';
  }

  set innerHTML(v) {
    this._html = v === null || v === undefined ? '' : String(v);
    this.children = [];
    this._text = '';
  }

  get innerHTML() { return this._html; }

  /* 结构 -------------------------------------------------------------- */

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  get childElementCount() { return this.children.length; }
  get firstChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }

  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }

  /* 查询：只支持 #id / .class / tag ---------------------------------- */

  static matches(node, sel) {
    if (!node || !sel) return false;
    if (sel[0] === '#') return node.attributes.id === sel.slice(1);
    if (sel[0] === '.') return node.classList.contains(sel.slice(1));
    return node.tagName === sel.toUpperCase();
  }

  querySelector(sel) {
    for (const child of this.children) {
      if (FakeElement.matches(child, sel)) return child;
      const deep = child.querySelector(sel);
      if (deep) return deep;
    }
    return null;
  }

  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      node.children.forEach((child) => {
        if (FakeElement.matches(child, sel)) out.push(child);
        walk(child);
      });
    };
    walk(this);
    return out;
  }
}

/** 建一个带 id 的容器并登记，测试里用 doc.qs('#xxx') 取 */
function register(sel, tag) {
  const node = new FakeElement(tag || 'div');
  if (sel[0] === '#') node.attributes.id = sel.slice(1);
  if (sel[0] === '.') node.classList.add(sel.slice(1));
  node.__key = sel;
  registry.set(sel, node);
  return node;
}

const body = new FakeElement('body');

const document = {
  body,
  createElement(tag) {
    idSeed += 1;
    return new FakeElement(tag);
  },
  querySelector(sel) {
    if (registry.has(sel)) return registry.get(sel);
    return body.querySelector(sel);
  },
  querySelectorAll(sel) {
    return body.querySelectorAll(sel);
  },
  getElementById(id) {
    return registry.get('#' + id) || null;
  },
};

/** 装到全局，供 board-view-*.js 使用 */
function install() {
  globalThis.document = document;
  return { document, body, register, FakeElement, reset: () => registry.clear() };
}

module.exports = { install, register, body, document, FakeElement };
