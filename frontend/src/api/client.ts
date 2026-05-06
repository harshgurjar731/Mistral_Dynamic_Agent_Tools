import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

const createClient = (baseURL: string) => {
  const instance = axios.create({
    baseURL,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  });

  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('auth_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  instance.interceptors.response.use(
    (res) => res,
    (err: AxiosError) => {
      const msg = (err.response?.data as Record<string,string>)?.detail ?? err.message;
      console.error('[API Error]', msg);
      return Promise.reject(err);
    }
  );

  return instance;
};

export const api = createClient('');
