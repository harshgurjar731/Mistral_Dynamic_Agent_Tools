import { api } from './client';

export const mcpApi = {
  listServers:  () => api.get('/api/mcp/servers'),
  register:     (data: object) => api.post('/api/mcp/servers', data),
  execute:      (server: string, tool: string, args: object) =>
    api.post(`/api/mcp/execute/${server}/${tool}`, { arguments: args }),
  healthCheck:  () => api.post('/api/mcp/health-check'),
};
