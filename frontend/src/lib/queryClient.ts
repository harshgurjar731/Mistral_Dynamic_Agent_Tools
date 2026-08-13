import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:          60_000,
      gcTime:             5 * 60_000,
      retry:              2,
      refetchOnWindowFocus: false,
    },
  },
});

export const QK = {
  agents:        ()         => ['agents'] as const,
  // A paged listing must key on its own page size, or two components asking
  // for different page sizes silently share one cache entry — the smaller
  // request wins and the larger one renders a truncated list. Still prefixed
  // with 'agents' so `invalidateQueries({ queryKey: QK.agents() })` reaches it.
  agentsPage:    (page: number, pageSize: number) =>
    ['agents', 'page', page, pageSize] as const,
  agent:         (id: string) => ['agents', id] as const,
  conversations: ()         => ['conversations'] as const,
  conversation:  (id: string) => ['conversations', id] as const,
  history:       (id: string) => ['conversations', id, 'history'] as const,
  workflows:     ()         => ['workflows'] as const,
  workflow:      (name: string) => ['workflows', name] as const,
  workflowScript: (name: string) => ['workflows', name, 'script'] as const,
  builderCatalog: ()        => ['workflows', 'builder', 'catalog'] as const,
  execution:     (id: string) => ['workflow-execution', id] as const,
  tools:         ()         => ['tools'] as const,
  pendingTools:  ()         => ['tools', 'pending'] as const,
  ontology:        ()           => ['ontology'] as const,
  ontologyTiers:   ()           => ['ontology', 'tiers'] as const,
  ontologyConcepts:(scheme = '') => ['ontology', 'concepts', scheme] as const,
  annotations:     (t: string, id: string) => ['ontology', 'annotations', t, id] as const,
  connectors:      ()           => ['connectors'] as const,
  connector:       (id: string) => ['connectors', id] as const,
  connectorTools:  (id: string) => ['connectors', id, 'tools'] as const,
  connectorCreds:  (id: string) => ['connectors', id, 'credentials'] as const,
  mcpServers:    ()         => ['mcp-servers'] as const,
  mcpServerTools: (name: string) => ['mcp-servers', name, 'tools'] as const,
  remoteServers: ()         => ['remote-servers'] as const,
  health:        ()         => ['health'] as const,
  libraries:     ()         => ['libraries'] as const,
  libraryDocs:   (id: string) => ['libraries', id, 'documents'] as const,
};
