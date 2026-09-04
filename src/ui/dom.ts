export interface ElementOptions {
  className?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? "" : String(value));
  }
  return node;
}

export function button(
  text: string,
  action: string,
  className: string,
  data: Record<string, string> = {},
): HTMLButtonElement {
  const node = element("button", {
    className,
    attrs: { type: "button", "data-action": action },
  });
  node.textContent = text;
  for (const [name, value] of Object.entries(data)) node.dataset[name] = value;
  return node;
}

export function append(parent: HTMLElement, ...children: Array<Node | null | undefined>): void {
  for (const child of children) {
    if (child) parent.appendChild(child);
  }
}

export function textPair(
  title: string,
  meta: string,
  titleClass = "yiji-row-title",
  metaClass = "yiji-row-meta",
): HTMLSpanElement {
  const wrapper = element("span");
  append(
    wrapper,
    element("span", { className: titleClass, text: title }),
    element("span", { className: metaClass, text: meta }),
  );
  return wrapper;
}
