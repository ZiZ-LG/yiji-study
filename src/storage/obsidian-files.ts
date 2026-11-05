import { TFile, normalizePath } from "obsidian";
import type { Vault } from "obsidian";
import type { LibraryFiles } from "./library-repository";

export function vaultPath(value: string): string {
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value) || value.split(/[\\/]/).some((part) => part === ".." || part === ".")
    || [...value].some((character) => character.charCodeAt(0) < 32)) throw new Error("文件路径无效。");
  const path = normalizePath(value);
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === ".")
    || [...path].some((character) => character.charCodeAt(0) < 32)) throw new Error("文件路径无效。");
  return path;
}

export class ObsidianFiles implements LibraryFiles {
  constructor(readonly vault: Vault) {}

  async list(directory: string): Promise<string[]> {
    const root = vaultPath(directory);
    const stat = await this.vault.adapter.stat(root);
    if (!stat) return [];
    if (stat.type !== "folder") throw new Error(`目录位置被文件占用：${root}`);
    const files: string[] = [];
    const pending = [root];
    const visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      // Vault's index can still be empty during plugin onload. Enumerate storage,
      // and propagate failures instead of treating an unreadable library as new.
      const entries = await this.vault.adapter.list(current);
      const within = (path: string): string => {
        const normalized = vaultPath(path);
        if (!normalized.startsWith(`${current}/`)) throw new Error("资料目录返回了范围外的文件，已停止读取。");
        return normalized;
      };
      files.push(...entries.files.map(within));
      pending.push(...entries.folders.map(within));
    }
    return [...new Set(files)].sort();
  }

  async exists(path: string): Promise<boolean> { return this.vault.adapter.exists(vaultPath(path)); }

  async ensureParent(path: string): Promise<void> {
    const parts = vaultPath(path).split("/").slice(0, -1);
    let parent = "";
    for (const part of parts) {
      parent = parent ? `${parent}/${part}` : part;
      const existing = await this.vault.adapter.stat(parent);
      if (existing && existing.type !== "folder") throw new Error(`目录位置被文件占用：${parent}`);
      if (!existing) {
        try { await this.vault.adapter.mkdir(parent); }
        catch (error) { if ((await this.vault.adapter.stat(parent))?.type !== "folder") throw error; }
      }
    }
  }

  async read(path: string): Promise<string> {
    const normalized = vaultPath(path);
    const file = this.vault.getAbstractFileByPath(normalized);
    return file instanceof TFile ? this.vault.read(file) : this.vault.adapter.read(normalized);
  }

  async write(path: string, text: string): Promise<void> {
    const normalized = vaultPath(path);
    await this.ensureParent(normalized);
    const file = this.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) await this.vault.process(file, () => text);
    else await this.vault.adapter.write(normalized, text);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const normalized = vaultPath(path);
    const file = this.vault.getAbstractFileByPath(normalized);
    return file instanceof TFile ? this.vault.readBinary(file) : this.vault.adapter.readBinary(normalized);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const normalized = vaultPath(path);
    await this.ensureParent(normalized);
    const file = this.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) await this.vault.modifyBinary(file, data);
    else await this.vault.adapter.writeBinary(normalized, data);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

export function base64ToBuffer(value: string): ArrayBuffer {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}
