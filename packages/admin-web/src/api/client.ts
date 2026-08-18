import axios from 'axios';
import { setBackendDown } from './connection';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `${window.location.origin}/api`;

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// 请求是否因「无法连接后端」而失败：
// error.response 为空代表请求未到达后端（网络断开 / 服务未启动 / CORS / 代理失败），
// 区别于有响应的 4xx/5xx（后端可达，只是业务/鉴权错误）。
function isConnectionError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return !error.response;
}

// 请求拦截器：附加JWT token
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器：处理401错误 + 后端连接状态
client.interceptors.response.use(
  (response) => {
    // 任意成功响应都说明后端已恢复
    setBackendDown(false);
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/admin/login';
    } else if (isConnectionError(error)) {
      // 后端连不上：标记全局状态，由 UI 横幅明确提示用户
      setBackendDown(true);
    }
    return Promise.reject(error);
  }
);

export default client;
