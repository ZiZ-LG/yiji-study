import type { QuestionOption, QuestionType } from "../domain/question";

export type SourceKind = "text" | "markdown" | "csv" | "json" | "docx" | "pdf" | "image";
export type SourceRole = "questions" | "answers" | "reference";
export interface SourceUnit {
  id: string;
  locator: string;
  text: string;
  /** Original extracted text before Unicode/layout normalization. */
  rawText?: string;
  page?: number;
  /** Local image content only. Sending it to an AI requires explicit scope selection. */
  imageDataUrl?: string;
  attachmentIds?: string[];
  needsRecognition?: boolean;
  issues?: ImportIssue[];
}
export interface SourceAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  locator: string;
  purpose?: "preview" | "content";
}
export interface SourceDocument {
  id: string;
  name: string;
  hash: string;
  kind: SourceKind;
  role: SourceRole;
  paperTitle: string;
  units: SourceUnit[];
  attachments: SourceAttachment[];
  totalUnits: number;
  omittedUnitIds: string[];
  warnings: string[];
}
export interface DocumentInput {
  name: string;
  bytes: Uint8Array;
  role?: SourceRole;
  paperTitle?: string;
}
export interface ImportIssue {
  code: string;
  message: string;
  blocking: boolean;
}
export interface ImportCandidate {
  id: string;
  ordinal: string;
  type: QuestionType | "unsupported";
  stem: string;
  options: QuestionOption[];
  answers: string[];
  domain: string;
  explanation: string;
  explanationOrigin?: "source" | "ai" | "user";
  sourceId: string;
  sourceUnitIds: string[];
  sourceLocator: string;
  paperTitle: string;
  issues: ImportIssue[];
  answerOrigin: "source" | "ai" | "user";
  answerSourceId?: string;
  answerSourceLocator?: string;
  attachments: string[];
  /** Original source text is never overwritten when the user edits the candidate. */
  originalText: string;
  points?: number;
}
export interface AnswerEntry {
  paperTitle: string;
  ordinal: string;
  type?: QuestionType;
  answers: string[];
  sourceId: string;
  sourceLocator: string;
}
export interface ImportBatch {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceHashes: string[];
  selectedUnitIds: string[];
  completedUnitIds: string[];
  failedUnitIds: string[];
  status: "draft" | "processing" | "review" | "interrupted";
  candidates: ImportCandidate[];
  warnings: string[];
}
export interface ImportResult {
  candidates: ImportCandidate[];
  warnings: string[];
  unresolvedUnitIds: string[];
  declaredQuestionCount?: number;
}
export interface ImportScope {
  /** Explicit identifiers of the units approved for this request; no implicit all-files default. */
  unitIds: string[];
  taskId?: string;
  instructions?: string;
}
export interface CodexTask {
  taskId: string;
  markdown: string;
  scope: ImportScope;
  assets: { name: string; dataUrl: string }[];
}
export interface AiConfiguration {
  endpoint: string;
  model: string;
  supportsImages: boolean;
  maxOutputTokens?: number;
}
export interface AiRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}
export interface AiResponse { status: number; text: string }
export type AiTransport = (request: AiRequest, signal?: AbortSignal) => Promise<AiResponse>;

/** The subset of PDF.js used here. The Obsidian host supplies loadPdfJs(). */
export interface PdfLibrary {
  getDocument(options: { data: Uint8Array; isEvalSupported: false; useSystemFonts: boolean }): {
    promise: Promise<PdfDocument>;
    destroy?: () => Promise<void>;
  };
}
export interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
export interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>;
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    intent?: "display" | "print";
  }): { promise: Promise<void>; cancel?: () => void };
  cleanup?: () => void;
}
export interface ExtractOptions {
  pdf?: PdfLibrary;
  pages?: number[];
  pageRange?: { from: number; to: number };
  renderAllPdfPages?: boolean;
  maxFileBytes?: number;
  maxPages?: number;
  createCanvas?: () => HTMLCanvasElement;
  parseXml?: (xml: string) => Document;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  onStage?: (status: { phase: "load" | "text" | "render" | "release"; page?: number; total?: number }) => void;
  /** Bound a single unresponsive render, not the total document processing time. */
  renderTimeoutMs?: number;
}
