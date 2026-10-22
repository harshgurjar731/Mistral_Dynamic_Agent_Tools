/** Tool safety rules — Settings → Tool safety. */
import { del, get, patch, post } from "./client";

export type Strictness = "advise" | "standard" | "strict";
export type PointKind = "guidance" | "screen";

export interface SafetyRule {
  id: string;
  title: string;
  /** Completes "Never design or request a tool that …". */
  rule: string;
  enabled: boolean;
  strictness: Strictness;
  applies_to: string[];
  builtin: boolean;
  sort: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface SafetyPoint {
  key: string;
  kind: PointKind;
  label: string;
  detail: string;
}

export interface StrictnessLevel {
  key: Strictness;
  label: string;
  /** What it means where a rule guides a prompt. */
  guidance: string;
  /** What it means where a rule screens a build. */
  screen: string;
}

export interface SafetyPayload {
  rules: SafetyRule[];
  points: SafetyPoint[];
  strictness: StrictnessLevel[];
  summary: { active_rules: number; points_in_use: string[] };
}

export interface SafetyRuleInput {
  title: string;
  rule: string;
  strictness: Strictness;
  applies_to: string[];
  enabled: boolean;
}

const B = "/api/safety-rules";

export const safetyApi = {
  list: () => get<SafetyPayload>(B),
  create: (body: SafetyRuleInput) => post<SafetyRule>(B, body),
  update: (id: string, body: Partial<SafetyRuleInput>) =>
    patch<SafetyRule>(`${B}/${encodeURIComponent(id)}`, body),
  remove: (id: string) => del<{ deleted: string }>(`${B}/${encodeURIComponent(id)}`),
  turnAllOff: () => post<SafetyPayload & { turned_off: number }>(`${B}/turn-off`),
};
