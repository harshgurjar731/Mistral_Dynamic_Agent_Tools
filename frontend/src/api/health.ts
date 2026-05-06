import { api } from './client';

export const healthApi = {
  orchestrator: () => api.get('/health').then(r => r.data),
};
