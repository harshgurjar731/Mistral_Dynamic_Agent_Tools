import { api } from './client';

export interface UploadResult {
  filename: string;
  content_type: string;
  size_bytes: number;
  image_base64: string;
  image_url: string;
  image_mime: string;
}

export const uploadsApi = {
  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<UploadResult>('/api/uploads/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60_000,
    });
  },
};
