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
  agent:         (id: string) => ['agents', id] as const,
  conversations: ()         => ['conversations'] as const,
  conversation:  (id: string) => ['conversations', id] as const,
  history:       (id: string) => ['conversations', id, 'history'] as const,
  workflows:     ()         => ['workflows'] as const,
  workflow:      (name: string) => ['workflows', name] as const,
  execution:     (id: string) => ['workflow-execution', id] as const,
  tools:         ()         => ['tools'] as const,
  pendingTools:  ()         => ['tools', 'pending'] as const,
  mcpServers:    ()         => ['mcp-servers'] as const,
  health:        ()         => ['health'] as const,
  libraries:     ()         => ['libraries'] as const,
  libraryDocs:   (id: string) => ['libraries', id, 'documents'] as const,
};
