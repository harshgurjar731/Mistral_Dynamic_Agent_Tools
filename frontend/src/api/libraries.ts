import { api } from './client';

export interface Library {
  id: string;
  name: string;
  description?: string;
  document_count?: number;
  created_at?: string;
}

export interface LibraryDocument {
  id: string;
  filename: string;
  size?: number;
  created_at?: string;
  mime_type?: string;
}

export const librariesApi = {
  list:           ()                                              => api.get<Library[]>('/api/libraries'),
  create:         (body: { name: string; description?: string })  => api.post<Library>('/api/libraries', body),
  update:         (id: string, body: { name?: string; description?: string }) => api.put<Library>(`/api/libraries/${id}`, body),
  delete:         (id: string)                                    => api.delete(`/api/libraries/${id}`),
  listDocuments:  (id: string)                                    => api.get<LibraryDocument[]>(`/api/libraries/${id}/documents`),
  uploadDocument: (id: string, file: File)                        => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/api/libraries/${id}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300_000, // 5 min timeout for large files
    });
  },
  uploadWebpage:  (id: string, url: string)                       => api.post(`/api/libraries/${id}/documents/webpage`, { url }),
  deleteDocument: (id: string, docId: string)                     => api.delete(`/api/libraries/${id}/documents/${docId}`),
};
