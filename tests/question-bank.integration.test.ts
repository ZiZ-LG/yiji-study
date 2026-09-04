import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import type { Vault } from "obsidian";
import {
  TYPE_BANK_ROOT,
  buildQuestionBank,
  isQuestionSourcePath,
  loadQuestionBank,
} from "../src/data/question-bank";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(projectRoot, TYPE_BANK_ROOT);
const realSourceIt = existsSync(sourceRoot) ? it : it.skip;

function loadRealQuestionFiles() {
  const typeDirectories = ["01-单选题专项", "02-多选题专项", "03-判断题专项"];
  return typeDirectories.flatMap((directory) => {
    const absoluteDirectory = join(sourceRoot, directory);
    return readdirSync(absoluteDirectory)
      .filter((name) => name.includes("-测验-第") && name.endsWith(".md"))
      .map((name) => {
        const absolutePath = join(absoluteDirectory, name);
        return {
          path: relative(projectRoot, absolutePath).split(sep).join("/"),
          content: readFileSync(absolutePath, "utf8"),
        };
      });
  });
}

function createFakeVault(files: ReturnType<typeof loadRealQuestionFiles>): Vault {
  const contentByPath = new Map(files.map((file) => [file.path, file.content]));
  return {
    getMarkdownFiles: () => files.map((file) => ({ path: file.path })),
    cachedRead: async (file: { path: string }) => contentByPath.get(file.path) ?? "",
  } as unknown as Vault;
}

describe("real Study_Vault question bank", () => {
  it("只识别题型版测验卷", () => {
    expect(
      isQuestionSourcePath(
        "Study_Vault/电力交易员StudyVault-题型版/01-单选题专项/单选题专项-测验-第1卷.md",
      ),
    ).toBe(true);
    expect(
      isQuestionSourcePath(
        "Study_Vault/电力交易员StudyVault/01-电力市场基础与政策/电力市场基础与政策-测验.md",
      ),
    ).toBe(false);
    expect(
      isQuestionSourcePath(
        "Study_Vault/电力交易员StudyVault-题型版/01-单选题专项/单选题专项.md",
      ),
    ).toBe(false);
  });

  realSourceIt("完整加载 1085 道去重题且稳定 ID 无碰撞", () => {
    const files = loadRealQuestionFiles();
    const bank = buildQuestionBank(files);

    expect(files).toHaveLength(20);
    expect(bank.counts).toEqual({
      single: 503,
      multiple: 277,
      judge: 305,
      total: 1085,
    });
    expect(bank.questions.every((question) => question.domain.length > 0)).toBe(true);
    expect(new Set(bank.questions.map((question) => question.id)).size).toBe(1085);
    expect(bank.byId.size).toBe(1085);
    expect(bank.domains).toHaveLength(22);
    expect(bank.issues).toEqual([]);
  });

  it("空白同事仓库使用内置题包", async () => {
    const emptyBank = await loadQuestionBank(createFakeVault([]));

    expect(emptyBank.sourceKind).toBe("embedded");
    expect(emptyBank.counts.total).toBe(1085);
  });

  realSourceIt("题源不完整时使用内置题包", async () => {
    const realFiles = loadRealQuestionFiles();
    const partialBank = await loadQuestionBank(createFakeVault(realFiles.slice(0, 1)));

    expect(partialBank.sourceKind).toBe("embedded");
    expect(partialBank.counts.total).toBe(1085);
  });

  realSourceIt("完整开发题源存在时继续读取 Markdown", async () => {
    const bank = await loadQuestionBank(createFakeVault(loadRealQuestionFiles()));

    expect(bank.sourceKind).toBe("markdown");
    expect(bank.counts).toEqual({ single: 503, multiple: 277, judge: 305, total: 1085 });
    expect(bank.issues).toEqual([]);
  });
});
