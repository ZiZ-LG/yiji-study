import type { QuestionType } from "../domain/question";

export interface ExamSectionDefinition {
  type: QuestionType;
  label: string;
  questionCount: number;
  pointsPerQuestion: number;
}

export interface PaperSummaryDefinition {
  id: string;
  title: string;
  badge: "原卷" | "模拟";
}

export interface StudyContentPackage {
  id: string;
  contentVersion: string;
  name: string;
  questionBankRoot: string;
  knowledgeRoot: string;
  domains: readonly string[];
  sourceFileCount: number;
  expectedQuestionCounts: Record<QuestionType, number> & { total: number };
  questionTypeDirectories: Record<QuestionType, string>;
  exam: {
    durationMinutes: number;
    totalScore: number;
    sections: readonly ExamSectionDefinition[];
    papers: readonly PaperSummaryDefinition[];
  };
}

const ELECTRICITY_TRADER_DOMAINS = [
  "电力市场基础与政策",
  "电力系统基础知识",
  "经济学基础",
  "职业道德与电力精神",
  "市场准入与注册管理",
  "中长期交易",
  "电力现货市场",
  "辅助服务市场",
  "电价机制与成本",
  "发电机组参数与成本分析",
  "交易组织与执行流程",
  "合同管理与履约",
  "计量结算与偏差处理",
  "信息披露与交易平台操作",
  "负荷预测与数据分析",
  "交易员岗位与市场分析",
  "政策文件解读与查询",
  "信用管理与评价",
  "合规管理与风险控制",
  "零售市场与售电服务",
  "绿电新能源与需求响应",
  "省间与跨区交易",
] as const;

export const ACTIVE_CONTENT_PACKAGE: StudyContentPackage = {
  id: "electricity-trader-level-4",
  contentVersion: "study-vault-2026-09-03",
  name: "电力交易员四级",
  questionBankRoot: "Study_Vault/电力交易员StudyVault-题型版",
  knowledgeRoot: "Study_Vault/电力交易员StudyVault",
  domains: ELECTRICITY_TRADER_DOMAINS,
  sourceFileCount: 20,
  expectedQuestionCounts: { single: 503, multiple: 277, judge: 305, total: 1085 },
  questionTypeDirectories: {
    single: "01-单选题专项",
    multiple: "02-多选题专项",
    judge: "03-判断题专项",
  },
  exam: {
    durationMinutes: 120,
    totalScore: 100,
    sections: [
      { type: "single", label: "单选", questionCount: 100, pointsPerQuestion: 0.5 },
      { type: "multiple", label: "多选", questionCount: 30, pointsPerQuestion: 1 },
      { type: "judge", label: "判断", questionCount: 40, pointsPerQuestion: 0.5 },
    ],
    papers: [
      { id: "sample-1", title: "四级 · 第 1 套样卷", badge: "原卷" },
      { id: "sample-2", title: "四级 · 第 2 套样卷", badge: "原卷" },
      { id: "mock-1", title: "四级 · 模拟卷 1", badge: "模拟" },
      { id: "mock-2", title: "四级 · 模拟卷 2", badge: "模拟" },
      { id: "mock-3", title: "四级 · 模拟卷 3", badge: "模拟" },
      { id: "mock-4", title: "四级 · 模拟卷 4", badge: "模拟" },
      { id: "mock-5", title: "四级 · 模拟卷 5", badge: "模拟" },
    ],
  },
};

export function getExamQuestionCount(contentPackage: StudyContentPackage): number {
  return contentPackage.exam.sections.reduce((total, section) => total + section.questionCount, 0);
}

export function getExamRuleText(contentPackage: StudyContentPackage): string {
  const sectionText = contentPackage.exam.sections
    .map((section) => `${section.questionCount} 道${section.label}`)
    .join("、");
  return `每套固定为 ${sectionText}，共 ${getExamQuestionCount(contentPackage)} 题、${contentPackage.exam.durationMinutes} 分钟、${contentPackage.exam.totalScore} 分。`;
}

export function getKnowledgeNotePath(contentPackage: StudyContentPackage, domain: string): string | null {
  const index = contentPackage.domains.indexOf(domain);
  if (index < 0) return null;
  const folder = `${String(index + 1).padStart(2, "0")}-${domain}`;
  return `${contentPackage.knowledgeRoot}/${folder}/${domain}.md`;
}
