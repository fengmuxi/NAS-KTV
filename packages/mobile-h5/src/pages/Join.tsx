/* Hallmark · genre: editorial · theme: Garden · Marquee Hero · Join page
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * designed-as-app
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRoomStore } from '../stores/room';
import { roomsApi } from '../api/rooms';
import QrScanner from '../components/QrScanner';
import RoomCodeInput from '../components/RoomCodeInput';
import { QrCode, LogIn, Loader2, Shuffle, X } from 'lucide-react';
import { randomNickname, loadNickname, saveNickname } from '../utils/nickname';

const css = `
/* Hallmark · genre: editorial · theme: Garden · Marquee Hero · Join page */

.join-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding-top: calc(env(safe-area-inset-top) + var(--space-2xl));
  padding-bottom: calc(env(safe-area-inset-bottom) + var(--space-2xl));
}

.join-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: var(--space-3xl);
}

.join-logo {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-xl);
  overflow: hidden;
  margin-bottom: var(--space-lg);
  box-shadow: var(--shadow-md);
}
.join-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.join-title {
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 9vw, 3.5rem);
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--color-ink);
  text-align: center;
}

.join-sub {
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--color-ink-2);
  text-align: center;
  margin-top: var(--space-md);
}

.join-card {
  width: 100%;
  max-width: 400px;
  padding: var(--space-lg);
  margin-left: var(--space-lg);
  margin-right: var(--space-lg);
  background-color: var(--color-paper-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
}

.join-field {
  margin-bottom: var(--space-lg);
}

.join-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}
.join-field-head .join-label {
  margin-bottom: 0;
}

/* 随机昵称按钮 */
.join-random-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 32px;
  padding: 0 var(--space-sm);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  color: var(--color-ink-2);
  font-family: var(--font-body);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.join-random-btn:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
  background-color: var(--color-accent-soft);
}
.join-random-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.join-random-btn:active {
  transform: scale(0.95);
}

.join-label {
  display: block;
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-ink-2);
  margin-bottom: var(--space-sm);
}

.join-input {
  width: 100%;
  padding: var(--space-md);
  font-size: var(--text-base);
  font-family: var(--font-body);
  background-color: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-ink);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out);
  min-height: 44px;
}
.join-input::placeholder {
  color: var(--color-ink-3);
}
.join-input:hover {
  border-color: var(--color-ink-3);
}
.join-input:focus-visible {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.join-input:active {
  border-color: var(--color-accent);
}
.join-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.join-input[data-state="error"] {
  border-color: var(--color-danger);
}
.join-input[data-state="success"] {
  border-color: var(--color-success);
}

.join-error {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-danger);
  text-align: center;
  margin-bottom: var(--space-md);
}

.join-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-ink-2);
  background-color: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-lg);
}
.join-notice-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-ink-2);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out);
}
.join-notice-close:hover {
  color: var(--color-ink);
  background-color: var(--color-paper-3);
}
.join-notice-close:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.join-btn-primary {
  width: 100%;
  padding: var(--space-md);
  font-size: var(--text-base);
  font-weight: 500;
  font-family: var(--font-body);
  background-color: var(--color-accent);
  color: var(--color-on-accent);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  min-height: 48px;
  transition: background-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out),
              opacity var(--dur-fast) var(--ease-out);
  margin-bottom: var(--space-md);
}
.join-btn-primary:hover {
  background-color: var(--color-accent-hover);
}
.join-btn-primary:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.join-btn-primary:active {
  transform: scale(0.98);
}
.join-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
.join-btn-primary[data-state="loading"] {
  background-color: var(--color-accent-hover);
  cursor: wait;
}
.join-btn-primary[data-state="loading"] .join-btn-icon {
  animation: join-spin 0.8s linear infinite;
}
.join-btn-primary[data-state="error"] {
  background-color: var(--color-danger);
}
.join-btn-primary[data-state="success"] {
  background-color: var(--color-success);
}

.join-divider {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}
.join-divider-line {
  flex: 1;
  height: 1px;
  background-color: var(--color-border);
}
.join-divider-text {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-ink-3);
}

.join-btn-secondary {
  width: 100%;
  padding: var(--space-md);
  font-size: var(--text-base);
  font-weight: 500;
  font-family: var(--font-body);
  background-color: var(--color-paper);
  color: var(--color-ink);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  min-height: 48px;
  transition: background-color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.join-btn-secondary:hover {
  background-color: var(--color-paper-3);
  border-color: var(--color-ink-3);
}
.join-btn-secondary:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.join-btn-secondary:active {
  transform: scale(0.98);
}
.join-btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
.join-btn-secondary[data-state="loading"] {
  cursor: wait;
}
.join-btn-secondary[data-state="error"] {
  border-color: var(--color-danger);
  color: var(--color-danger);
}
.join-btn-secondary[data-state="success"] {
  border-color: var(--color-success);
  color: var(--color-success);
}

@keyframes join-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .join-btn-primary,
  .join-btn-secondary,
  .join-input {
    transition-duration: 0.01ms !important;
  }
  .join-btn-primary[data-state="loading"] .join-btn-icon {
    animation: none;
  }
}
`;

export default function Join() {
  const navigate = useNavigate();
  const { setJoined } = useRoomStore();
  const [showScanner, setShowScanner] = useState(false);
  const [authorizationCode, setAuthorizationCode] = useState('');
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const [nickname, setNickname] = useState(() => loadNickname());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaveReason, setLeaveReason] = useState<string | null>(null);

  // 会话/授权码失效回到本页时，根据 URL reason 参数展示对应提示
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('reason');
    if (!reason) return;
    const messages: Record<string, string> = {
      'session-expired': '会话已过期，请使用电视上的授权码重新加入',
      'code-rotated': '电视端已更新授权码，请使用新授权码加入',
      'room-not-found': '房间不存在或已更换授权码，请重新加入',
      'room-closed': '房间已关闭，请重新加入',
    };
    setLeaveReason(messages[reason] ?? null);
  }, []);

  // 通过二维码链接（手机系统/微信「扫一扫」直接打开）进入时，授权码已随 URL 带入，自动加入房间。
  // 依赖 URL 中的授权码（location.search）而非仅挂载一次：同一页面再次扫码时
  // （URL 授权码变化、路由未变、组件不重新挂载），仍会用新授权码自动加入，而非沿用旧授权码。
  // 昵称由 loadNickname 保底（无保存值时自动生成随机昵称），不会因昵称为空而中断自动加入。
  const location = useLocation();
  const handledCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const codeFromUrl = params.get('authorizationCode');
    const tokenFromUrl = params.get('joinToken');
    if (!codeFromUrl || !/^[A-Z0-9]{6}$/.test(codeFromUrl)) return;
    if (handledCodeRef.current === codeFromUrl) return; // 同一授权码只自动加入一次（含 StrictMode 双调）
    handledCodeRef.current = codeFromUrl;
    setAuthorizationCode(codeFromUrl);
    setJoinToken(tokenFromUrl);
    // handleJoin 为函数声明，已 hoisted；此处自动加入，避免扫完还需手动点击
    // eslint-disable-next-line react-hooks/exhaustive-deps
    handleJoin(codeFromUrl, tokenFromUrl);
  }, [location.search]);

  async function handleJoin(code: string, token: string | null = joinToken) {
    if (code.length !== 6) {
      setError('请输入 6 位授权码');
      return;
    }
    if (!nickname.trim()) {
      setError('请输入昵称');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await roomsApi.joinRoom({
        authorizationCode: code,
        joinToken: token ?? undefined,
        nickname: nickname.trim()
      });

      setJoined({
        roomCode: result.roomCode,
        roomId: result.roomId,
        sessionId: result.sessionId,
        sessionToken: result.sessionToken,
        sessionExpiresAt: new Date(result.sessionExpiresAt).getTime(),
        nickname: nickname.trim()
      });

      navigate('/');
    } catch (e: any) {
      setError(e?.response?.data?.error || '加入失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  function handleScan(result: { authorizationCode: string; joinToken?: string }) {
    setAuthorizationCode(result.authorizationCode);
    setJoinToken(result.joinToken ?? null);
    setShowScanner(false);
    handleJoin(result.authorizationCode, result.joinToken ?? null);
  }

  function handleRandomNickname() {
    const gen = randomNickname();
    setNickname(gen);
    saveNickname(gen);
    if (error === '请输入昵称') setError(null);
  }

  function handleNicknameChange(value: string) {
    setNickname(value);
    saveNickname(value);
    if (error) setError(null);
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <style>{css}</style>

      <div className="join-wrap">
        <div className="join-brand">
          <div className="join-logo" aria-hidden="true">
            <img src="/api/logo" alt="" />
          </div>
          <h1 className="join-title">NASKTV</h1>
          <p className="join-sub">加入房间开始点歌</p>
        </div>

        <div className="join-card">
          {leaveReason && (
            <div className="join-notice" role="alert">
              <span>{leaveReason}</span>
              <button
                className="join-notice-close"
                onClick={() => setLeaveReason(null)}
                type="button"
                aria-label="关闭提示"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="join-field">
            <div className="join-field-head">
              <label className="join-label" htmlFor="join-nickname">
                你的昵称
              </label>
              <button
                onClick={handleRandomNickname}
                className="join-random-btn"
                type="button"
                aria-label="随机生成昵称"
              >
                <Shuffle size={14} />
                <span>换一个</span>
              </button>
            </div>
            <input
              id="join-nickname"
              type="text"
              value={nickname}
              onChange={(e) => handleNicknameChange(e.target.value)}
              maxLength={20}
              placeholder="请输入昵称"
              className="join-input"
              data-state={error === '请输入昵称' ? 'error' : undefined}
            />
          </div>

          <div className="join-field">
            <label className="join-label" htmlFor="join-room-code">
              授权码
            </label>
            <RoomCodeInput
              value={authorizationCode}
              onChange={value => {
                setAuthorizationCode(value);
                setJoinToken(null);
              }}
            />
          </div>

          {error && (
            <p className="join-error" role="alert">
              {error}
            </p>
          )}

          <button
            onClick={() => handleJoin(authorizationCode)}
            disabled={loading || authorizationCode.length !== 6 || !nickname.trim()}
            className="join-btn-primary"
            data-state={loading ? 'loading' : error ? 'error' : undefined}
            type="button"
          >
            {loading ? (
              <Loader2 size={20} className="join-btn-icon" />
            ) : (
              <>
                <LogIn size={20} />
                <span>加入房间</span>
              </>
            )}
          </button>

          <div className="join-divider" aria-hidden="true">
            <div className="join-divider-line" />
            <span className="join-divider-text">或</span>
            <div className="join-divider-line" />
          </div>

          <button
            onClick={() => setShowScanner(true)}
            className="join-btn-secondary"
            type="button"
          >
            <QrCode size={20} />
            <span>扫描二维码</span>
          </button>
        </div>
      </div>

      {showScanner && (
        <QrScanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
