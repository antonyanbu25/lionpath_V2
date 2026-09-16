/** User menu sign-out — panel delegation invokes logout callback. */

globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
};

globalThis.Element = class Element {};

class MockEl extends Element {
  constructor(id, tag = "div") {
    super();
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.hidden = true;
    this.dataset = {};
    this._listeners = {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this._teleportParent = null;
    this._teleportNext = null;
  }

  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }

  setAttribute() {}

  getAttribute(name) {
    if (name === "aria-expanded") return "false";
    return null;
  }

  contains(node) {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  closest(selector) {
    if (selector === `#${this.id}`) return this;
    for (const child of this.children) {
      const hit = child.closest?.(selector);
      if (hit) return hit;
    }
    return null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  querySelectorAll() {
    return [];
  }

  querySelector(selector) {
    const matches = (el) =>
      selector.startsWith("#") ? el.id === selector.slice(1) :
      selector.startsWith(".") ? (el.className || "").split(/\s+/).includes(selector.slice(1)) :
      false;
    for (const child of this.children) {
      if (matches(child)) return child;
      const found = child.querySelector?.(selector);
      if (found) return found;
    }
    return null;
  }

  dispatch(type, target) {
    const event = {
      type,
      target: target || this,
      preventDefault() {},
      stopPropagation() {},
    };
    for (const fn of this._listeners[type] || []) fn(event);
  }
}

const registry = new Map();
const trigger = new MockEl("sidebar-user", "button");
const panel = new MockEl("user-menu-panel");
const backdrop = new MockEl("user-menu-backdrop");
const signOut = new MockEl("user-menu-signout", "button");
const profile = new MockEl("user-menu-profile", "button");
panel.appendChild(signOut);
panel.appendChild(profile);

for (const el of [trigger, panel, backdrop, signOut, profile]) {
  registry.set(el.id, el);
}

globalThis.document = {
  documentElement: {
    setAttribute() {},
    classList: { toggle() {} },
    style: {},
    getAttribute: () => null,
  },
  body: new MockEl("body"),
  getElementById: (id) => registry.get(id) || null,
  addEventListener() {},
  querySelectorAll: () => [],
};

globalThis.window = {
  addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};

const { initUserMenu } = await import("../user-menu.js");

let signOutCalls = 0;
initUserMenu({
  getSession: () => ({ name: "Alex SE", email: "se@freshworks.com" }),
  onProfileSettings: () => {},
  onSignOut: () => {
    signOutCalls += 1;
  },
});

if (panel.dataset.userMenuWired !== "1") {
  console.error("FAILED: panel click delegation not wired");
  process.exit(1);
}

panel.dispatch("click", signOut);
if (signOutCalls !== 1) {
  console.error("FAILED: sign out callback not invoked");
  process.exit(1);
}

console.log("OK — user menu sign-out wiring");
