// Test host only. Production bundles continue to use the real Obsidian API.
Object.assign(globalThis, { createEl: (tag: string) => document.createElement(tag) });
Object.defineProperty(HTMLElement.prototype, "win", { get: () => window });
Object.assign(HTMLElement.prototype, {
  empty(this: HTMLElement) { this.replaceChildren(); },
  createDiv(this: HTMLElement, options: { cls?: string } = {}) {
    const node = document.createElement("div");
    node.className = options.cls ?? "";
    this.appendChild(node);
    return node;
  },
});

export class ItemView {
  contentEl = document.getElementById("app")!;
  containerEl = this.contentEl;
  app = { vault: { getAbstractFileByPath: () => null } };
  intervals: number[] = [];
  listeners: (() => void)[] = [];
  registerDomEvent(node: HTMLElement, type: string, callback: EventListener) {
    node.addEventListener(type, callback);
    this.listeners.push(() => node.removeEventListener(type, callback));
  }
  registerInterval(id: number) { this.intervals.push(id); }
  destroy() { this.intervals.forEach(clearInterval); this.listeners.forEach((dispose) => dispose()); }
}
export class Notice {
  constructor(message: string) { document.body.dataset.notice = message; }
}
export function setIcon(node: HTMLElement) { node.textContent = "◇"; }
