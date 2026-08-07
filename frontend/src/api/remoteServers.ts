import { api } from './client';

export const remoteServersApi = {
  list:       () => api.get('/api/remote-servers'),
  add:        (data: { name: string; url: string; description?: string }) =>
                api.post('/api/remote-servers', data),
  delete:     (id: number) => api.delete(`/api/remote-servers/${id}`),
  get:        (id: number | string) => api.get(`/api/remote-servers/${id}`),
  update:     (id: number | string, data: { name?: string; url?: string; description?: string }) => 
                api.put(`/api/remote-servers/${id}`, data),
  check:      (url: string) => api.post('/api/remote-servers/check', { url }),
  sendTool:   (serverId: number | string, toolId: string | number) =>
                api.post(`/api/remote-servers/${serverId}/send-tool`, { tool_id: toolId }),
};
