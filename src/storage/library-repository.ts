import { contentDigest, mergeLibrary, parseLibrary, validateLibrary } from "../library";
import type { LibraryState } from "../library/types";

/** Storage adapter deliberately excludes OS paths and Node APIs. */
export interface LibraryFiles {
  list(directory: string): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface LibraryLoadResult {
  state: LibraryState | null;
  warnings: string[];
}

export function safeLibraryRoot(value: string): string {
  const root = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!root || root.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))
    || /[:*?"<>|]/.test(root) || [...root].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error("题库目录必须是仓库内的普通文件夹，不能包含隐藏目录或上级路径。");
  }
  return root;
}

/** Each device owns a different shard, so cloud file merging never arbitrates two answers. */
export class LibraryRepository {
  readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly files: LibraryFiles, root: string, private readonly deviceId: string) {
    this.root = safeLibraryRoot(root);
    if (!/^[a-zA-Z0-9_-]{4,100}$/.test(deviceId)) throw new Error("设备标识格式错误。");
  }

  get shardPath(): string { return `${this.root}/记录/${this.deviceId}.json`; }

  async load(): Promise<LibraryLoadResult> {
    const paths = [...new Set((await this.files.list(`${this.root}/记录`))
      .filter((path) => path.endsWith(".json"))
      .map((path) => path.replace(/\.previous\.json$/, ".json")))].sort();
    let state: LibraryState | null = null;
    const warnings: string[] = [];
    for (const path of paths) {
      let parsed: LibraryState | null = null;
      try { parsed = parseLibrary(JSON.parse(await this.files.read(path))); }
      catch { /* A partially synced file is handled below; never replace it with empty data. */ }
      if (!parsed) {
        const previous = path.replace(/\.json$/, ".previous.json");
        if (await this.files.exists(previous)) {
          try { parsed = parseLibrary(JSON.parse(await this.files.read(previous))); } catch { /* report below */ }
        }
        if (!parsed) throw new Error(`学习记录暂时无法读取：${path}。请等待同步完成或恢复备份，原文件未被覆盖。`);
        warnings.push(`记录 ${path} 无法读取，已使用上一份完整副本。请检查同步状态。`);
      }
      state = state ? mergeLibrary(state, parsed) : parsed;
    }
    if (state) state = { ...state, deviceId: this.deviceId };
    return { state, warnings };
  }

  /** Serialize writes and read the actual committed bytes before reporting success. */
  save(input: LibraryState): Promise<LibraryState> {
    const work = this.queue.then(() => this.saveNow(input));
    this.queue = work.catch(() => undefined);
    return work;
  }

  private async saveNow(input: LibraryState): Promise<LibraryState> {
    const validation = validateLibrary(input);
    if (!validation.valid) throw new Error(`题库未保存：${validation.issues.join("；")}`);
    const loaded = await this.load();
    const state = loaded.state ? mergeLibrary(input, loaded.state) : input;
    state.deviceId = this.deviceId;
    if (input.activeBankId && state.banks[input.activeBankId] && !state.banks[input.activeBankId]?.deletedAt) state.activeBankId = input.activeBankId;
    const text = JSON.stringify(state);
    const path = this.shardPath;
    if (await this.files.exists(path)) {
      const old = await this.files.read(path);
      if (old === text) return state;
      if (parseLibrary(old)) {
        await this.files.write(path.replace(/\.json$/, ".previous.json"), old);
        if (await this.files.read(path.replace(/\.json$/, ".previous.json")) !== old) throw new Error("上一份记录备份回读不一致，已停止写入。");
      } else {
        // Retain the exact damaged bytes before repairing from a validated previous snapshot.
        const quarantine = path.replace(/\.json$/, `.corrupt-${contentDigest(old)}.txt`);
        if (!await this.files.exists(quarantine)) await this.files.write(quarantine, old);
        if (await this.files.read(quarantine) !== old) throw new Error("损坏记录尚未完整保留，已停止写入。");
      }
    }
    try { await this.files.write(path, text); }
    catch (error) {
      // A write can succeed even if the host loses its response. Reconcile, do not blindly retry.
      if (!await this.files.exists(path) || await this.files.read(path) !== text) throw error;
    }
    if (await this.files.read(path) !== text) throw new Error("保存后回读不一致，请等待同步并重新读取；没有再次写入。");
    return state;
  }
}
