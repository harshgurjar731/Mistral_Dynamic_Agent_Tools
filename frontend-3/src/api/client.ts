import axios, { AxiosError } from "axios";

/** Relative baseURL — the dev proxy forwards /api, /health and /uploads to the backend. */
export const api = axios.create({
  baseURL: "",
  timeout: 420_000, // 7 min: synthesis + planning are slow
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem("auth_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError<{ detail?: string; message?: string; error?: string }>) => {
    const msg = err.response?.data?.detail ?? err.response?.data?.message ?? err.message;
    console.error("[API Error]", msg);
    return Promise.reject(err);
  },
);

/** Human-readable message from either backend error envelope. */
export function errorMessage(err: unknown): string {
  const e = err as AxiosError<{ detail?: unknown; message?: string; error?: string }> & {
    message?: string;
  };
  const data = e?.response?.data;
  if (data) {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((d: unknown) =>
          typeof d === "string" ? d : ((d as { msg?: string })?.msg ?? JSON.stringify(d)),
        )
        .join(", ");
    }
    // Structured details, e.g. a 409 carrying a prerequisite report.
    const nested = (data.detail as { message?: unknown } | null | undefined)?.message;
    if (typeof nested === "string") return nested;
    if (data.message) return data.message;
    if (data.error) return data.error;
  }
  return e?.message ?? "Unexpected error";
}

/** Extra technical context for the "details" disclosure of an error card. */
export function errorDetails(err: unknown): string | undefined {
  const e = err as AxiosError<Record<string, unknown>>;
  const status = e?.response?.status;
  const body = e?.response?.data;
  if (!status && !body) return undefined;
  return `${status ?? ""} ${body ? JSON.stringify(body, null, 2) : ""}`.trim();
}

/**
 * Some endpoints return HTTP 200 with an `{ error: "..." }` body. Always run
 * responses through this before treating them as success.
 */
export function unwrap<T>(data: T): T {
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === "string" && err.length > 0) throw new Error(err);
  return data;
}

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<T>(url, { params });
  return unwrap(res.data);
}
export async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.post<T>(url, body ?? {});
  return unwrap(res.data);
}
export async function put<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.put<T>(url, body ?? {});
  return unwrap(res.data);
}
export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch<T>(url, body ?? {});
  return unwrap(res.data);
}
export async function del<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.delete<T>(url, { params });
  return unwrap(res.data);
}
