import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AlertCircle } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import Button from '../components/Button';
import Input from '../components/Input';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        // 无响应对象 = 请求未到达后端（网络断开 / 服务未启动 / CORS），
        // 此时不应误导为「用户名密码错误」
        if (!err.response) {
          setError('无法连接后端服务，请确认后端已启动且网络可访问');
        } else {
          const data = err.response.data;
          setError(data?.error || data?.message || '登录失败，请检查用户名和密码');
        }
      } else {
        setError('登录失败，请检查用户名和密码');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-sm">
      <div className="w-full max-w-[400px] bg-paper-2 border border-border rounded-lg shadow-md p-lg">
        <div className="flex items-center gap-sm mb-sm">
          <img
            src="/api/logo"
            alt=""
            className="w-10 h-10 rounded-lg object-cover shrink-0"
          />
          <h1 className="text-2xl font-display font-bold text-ink">
            NASKTV 管理后台
          </h1>
        </div>
        <p className="text-sm text-ink-3 mb-lg">请登录以继续</p>

        <form onSubmit={handleSubmit} className="space-y-md">
          <Input
            label="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入用户名"
            required
            autoComplete="username"
          />
          <Input
            label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            required
            autoComplete="current-password"
          />

          {error && (
            <div className="flex items-center gap-sm text-sm text-danger">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" loading={loading} className="w-full">
            {loading ? '登录中...' : '登录'}
          </Button>
        </form>
      </div>
    </div>
  );
}
