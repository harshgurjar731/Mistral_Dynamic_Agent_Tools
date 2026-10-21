import { useQuery } from "@tanstack/react-query";
import { QK } from "@/api/queryKeys";
import { settingsApi, type SlimModel } from "@/api/settings";

/**
 * Offline fallback only — the real list and defaults come from the Settings
 * page (GET /api/settings/public). Read them through useModelConfig().
 */
export const CHAT_MODELS = [
  { value: "mistral-large-latest", label: "Mistral Large (latest)" },
  { value: "mistral-medium-latest", label: "Mistral Medium (latest)" },
  { value: "mistral-small-latest", label: "Mistral Small (latest)" },
  { value: "codestral-latest", label: "Codestral (latest)" },
] as const;

const FALLBACK_DEFAULT = "mistral-large-latest";
const NO_MODELS: SlimModel[] = [];

export interface ModelOption {
  value: string;
  label: string;
}

/** Model pickers and defaults, as configured on the Settings page. */
export function useModelConfig() {
  const query = useQuery({
    queryKey: QK.publicConfig(),
    queryFn: settingsApi.public,
    staleTime: 60_000,
  });
  const models = query.data?.models;
  const choices: ModelOption[] = models?.choices?.length
    ? models.choices
    : CHAT_MODELS.map((m) => ({ value: m.value, label: m.label }));
  return {
    choices,
    defaultAgentModel: models?.default_agent_model ?? FALLBACK_DEFAULT,
    chatDefaultModel: models?.chat_default_model ?? FALLBACK_DEFAULT,
    /** Every model the account can call (empty until the catalog is fetched). */
    allModels: models?.catalog ?? NO_MODELS,
    isLoaded: query.isSuccess,
  };
}

/** A model's label from the configured choices, else the raw id. */
export function modelLabel(choices: ModelOption[], value: string): string {
  return choices.find((c) => c.value === value)?.label ?? value;
}
