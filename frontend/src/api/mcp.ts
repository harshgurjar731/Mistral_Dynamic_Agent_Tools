import { api } from './client';

export const mcpApi = {
  listServers:    () => api.get('/api/mcp/servers'),
  register:       (data: object) => api.post('/api/mcp/servers', data),
  deleteServer:   (name: string) => api.delete(`/api/mcp/servers/${name}`),
  disconnect:     (name: string) => api.post(`/api/mcp/servers/${name}/disconnect`),
  reconnect:      (name: string) => api.post(`/api/mcp/servers/${name}/reconnect`),
  getServerTools: (name: string) => api.get(`/api/mcp/servers/${name}/tools`),
  execute:        (server: string, tool: string, args: object) =>
    api.post(`/api/mcp/execute/${server}/${tool}`, { arguments: args }),
  healthCheck:    () => api.post('/api/mcp/health-check'),
};
