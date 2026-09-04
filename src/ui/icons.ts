import { setIcon } from "obsidian";
import { element } from "./dom";

export function icon(name: string, className = "yiji-icon"): HTMLSpanElement {
  const node = element("span", { className, attrs: { "aria-hidden": "true" } });
  setIcon(node, name);
  return node;
}

export function iconButton(
  name: string,
  label: string,
  action: string,
  className = "yiji-icon-button",
): HTMLButtonElement {
  const node = element("button", {
    className,
    attrs: {
      type: "button",
      "aria-label": label,
      "data-action": action,
    },
  });
  node.appendChild(icon(name));
  return node;
}
