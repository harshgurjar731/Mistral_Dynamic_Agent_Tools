import { useRef } from "react";
import { AlertTriangle, Database, FileUp, KeyRound, Network, Plug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { DeploymentManifest, DeploymentSetupField, SetupState } from "./deploySetupModel";

/* ── The form ── */

const GROUPS: { id: string; title: string; icon: typeof KeyRound }[] = [
  { id: "worker", title: "Worker", icon: KeyRound },
  { id: "tool", title: "Third-party credentials used by the tool code", icon: KeyRound },
  { id: "connector", title: "Connectors", icon: Plug },
  { id: "database", title: "Databases", icon: Database },
];

function Field({
  field,
  value,
  onChange,
  keptOnServer,
}: {
  field: DeploymentSetupField;
  value: string;
  onChange: (v: string) => void;
  keptOnServer: boolean;
}) {
  const required = field.required && !field.default && !keptOnServer;
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1.5 text-xs">
        {field.label}
        {required ? <span className="text-red">*</span> : null}
        <code className="ml-auto font-mono text-[10px] text-muted-foreground">{field.key}</code>
      </Label>
      <Input
        type={field.secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          field.default
            ? field.default
            : keptOnServer
              ? "Blank keeps the value already on the server"
              : field.secret
                ? "Not stored by this app"
                : ""
        }
        autoComplete={field.secret ? "new-password" : "off"}
        spellCheck={false}
        className="font-mono text-xs"
      />
      {field.help ? <p className="text-[11px] text-muted-foreground">{field.help}</p> : null}
    </div>
  );
}

/**
 * Everything a workflow needs from the operator before it can run elsewhere:
 * the Mistral key and worker queue, the tool code's third-party secrets,
 * connector credentials, and where the SQL tools' database comes from.
 * ``keptOnServer`` lists keys a redeploy may leave blank.
 */
export function DeploySetupForm({
  manifest,
  value,
  onChange,
  keptOnServer = [],
  disabled = false,
}: {
  manifest: DeploymentManifest;
  value: SetupState;
  onChange: (s: SetupState) => void;
  keptOnServer?: string[];
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const fields = manifest.setup ?? [];
  const setEnv = (key: string, v: string) =>
    onChange({ ...value, env: { ...value.env, [key]: v } });

  const readSeed = async (file: File | undefined) => {
    if (!file) return;
    onChange({ ...value, seedSql: await file.text(), seedName: file.name });
  };

  return (
    <fieldset disabled={disabled} className="space-y-4">
      {GROUPS.map((g) => {
        const groupFields = fields.filter((f) => f.group === g.id);
        const showConnectors = g.id === "connector" && manifest.connectors.length > 0;
        const showDatabases =
          g.id === "database" && (manifest.uses_knowledge_graph || manifest.uses_sql_tools);
        if (!groupFields.length && !showConnectors && !showDatabases) return null;
        const Icon = g.icon;
        return (
          <div key={g.id} className="space-y-2.5 rounded-lg border border-border/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Icon className="size-3.5 text-muted-foreground" /> {g.title}
            </p>

            {showConnectors
              ? manifest.connectors.map((c) => (
                  <div key={c.connector_name ?? c.connector_id} className="text-[11px]">
                    <span className="font-mono text-foreground">{c.connector_name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · used by {(c.used_by ?? []).join(", ")} ·{" "}
                      {c.is_directory
                        ? "directory connector — install it from Studio on the target workspace first"
                        : "created on the target workspace if missing"}
                      {c.auth === "oauth2"
                        ? "; sign in once through the link the worker log prints after deploy"
                        : ""}
                    </span>
                  </div>
                ))
              : null}

            {groupFields.map((f) => (
              <Field
                key={f.key}
                field={f}
                value={value.env[f.key] ?? ""}
                onChange={(v) => setEnv(f.key, v)}
                keptOnServer={keptOnServer.includes(f.key)}
              />
            ))}

            {g.id === "database" && manifest.uses_knowledge_graph ? (
              <p className="flex gap-1.5 text-[11px] text-muted-foreground">
                <Network className="mt-0.5 size-3 shrink-0" />A Neo4j container starts with the
                worker and is loaded with a copy of the agents' knowledge graph (
                {manifest.graph_library_ids?.length ?? 0} document librar
                {manifest.graph_library_ids?.length === 1 ? "y" : "ies"}) and domain knowledge.
              </p>
            ) : null}

            {g.id === "database" && manifest.uses_sql_tools ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  An agent uses the SQL tools. Their database on the server:
                </p>
                <RadioGroup
                  value={value.sqlMode}
                  onValueChange={(v) => onChange({ ...value, sqlMode: v as SetupState["sqlMode"] })}
                  className="gap-1.5"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <RadioGroupItem value="container" /> New PostgreSQL container on the server
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <RadioGroupItem value="external" /> An existing database
                  </label>
                </RadioGroup>
                {value.sqlMode === "external" ? (
                  <div className="space-y-1">
                    <Input
                      type="password"
                      value={value.sqlUrl}
                      onChange={(e) => onChange({ ...value, sqlUrl: e.target.value })}
                      placeholder="postgresql://user:password@host:5432/dbname (or mysql://…)"
                      autoComplete="new-password"
                      spellCheck={false}
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Must be reachable from the server. PostgreSQL, MySQL/MariaDB or SQLite.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".sql,text/plain"
                      className="hidden"
                      onChange={(e) => void readSeed(e.target.files?.[0])}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => fileRef.current?.click()}
                    >
                      <FileUp className="size-3.5" /> {value.seedName ? "Replace" : "Add"} seed .sql
                    </Button>
                    {value.seedName ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="font-mono">{value.seedName}</span>
                        <button
                          type="button"
                          aria-label="Remove seed file"
                          onClick={() => onChange({ ...value, seedSql: "", seedName: "" })}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Optional — schema and data, loaded once into the new database.
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      <p className="flex gap-1.5 text-[11px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        Values go to the server's .env (or the downloaded package's .env) and are never stored by
        this app.
      </p>
    </fieldset>
  );
}
