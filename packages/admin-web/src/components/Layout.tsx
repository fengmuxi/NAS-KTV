import { ReactNode, useEffect } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Music,
  Search,
  CopyX,
  User,
  Folder,
  Smartphone,
  Bot,
  Mic,
  Cpu,
  ScrollText,
  Settings,
  Download,
  ChevronLeft,
  ChevronRight,
  Menu,
  LogOut,
  X,
} from 'lucide-react';
import { useUiStore } from '../stores/ui';
import { useAuthStore } from '../stores/auth';

/* Hallmark · component: layout · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled (n/a) · loading (n/a) · error (n/a) · success (n/a)
 * contrast: pass (paper on ink sidebar, ink on paper content)
 */

const menuItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/download', label: '歌曲下载', icon: Download },
  { path: '/songs', label: '歌曲管理', icon: Music },
  { path: '/scan', label: '扫描任务', icon: Search },
  { path: '/dedup', label: '去重管理', icon: CopyX },
  { path: '/artists', label: '歌手管理', icon: User },
  { path: '/categories', label: '分类管理', icon: Folder },
  { path: '/devices', label: '设备授权', icon: Smartphone },
  { path: '/ai-parse', label: 'AI解析', icon: Bot },
  { path: '/separation', label: '人声分离', icon: Mic },
  { path: '/gpu', label: 'GPU管理', icon: Cpu },
  { path: '/logs', label: '运行日志', icon: ScrollText },
  { path: '/settings', label: '系统设置', icon: Settings },
];

export default function Layout({ children }: { children?: ReactNode }) {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const mobileSidebarOpen = useUiStore((s) => s.mobileSidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setMobileSidebar = useUiStore((s) => s.setMobileSidebar);
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarOpen = !sidebarCollapsed;

  useEffect(() => {
    setMobileSidebar(false);
  }, [location.pathname, setMobileSidebar]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const currentLabel =
    menuItems.find((m) => m.path === location.pathname)?.label || '管理后台';

  return (
    <div className="min-h-screen bg-paper text-ink font-body">
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          style={{
            backgroundColor:
              'color-mix(in oklch, var(--color-ink) 50%, transparent)',
          }}
          onClick={() => setMobileSidebar(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'fixed top-0 left-0 h-full bg-ink text-paper flex flex-col',
          'transition-all duration-200 ease-out',
          'z-40 lg:z-auto',
          'w-64',
          sidebarOpen ? 'lg:w-64' : 'lg:w-16',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        {/* Sidebar header */}
        <div
          className={[
            'flex items-center justify-between h-16 px-4 shrink-0',
            'border-b',
          ].join(' ')}
          style={{
            borderColor:
              'color-mix(in oklch, var(--color-paper) 10%, transparent)',
          }}
        >
          {/* Logo + 品牌名 */}
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/api/logo"
              alt=""
              className="w-8 h-8 rounded-md object-cover shrink-0"
            />
            <h1
              className={[
                'text-xl font-bold font-display text-paper whitespace-nowrap',
                !sidebarOpen ? 'lg:hidden' : '',
              ].join(' ')}
            >
              NASKTV
            </h1>
          </div>
          {/* Desktop collapse toggle */}
          <button
            onClick={() => toggleSidebar()}
            className={[
              'hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-md',
              'text-[color-mix(in_oklch,var(--color-paper)_70%,transparent)]',
              'hover:text-paper',
              'hover:bg-[color-mix(in_oklch,var(--color-paper)_10%,transparent)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
              'transition-colors',
            ].join(' ')}
            aria-label={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
          >
            {sidebarOpen ? (
              <ChevronLeft className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
          </button>
          {/* Mobile close */}
          <button
            onClick={() => setMobileSidebar(false)}
            className={[
              'lg:hidden inline-flex items-center justify-center w-8 h-8 rounded-md',
              'text-[color-mix(in_oklch,var(--color-paper)_70%,transparent)]',
              'hover:text-paper',
              'hover:bg-[color-mix(in_oklch,var(--color-paper)_10%,transparent)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              'transition-colors',
            ].join(' ')}
            aria-label="关闭菜单"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav
          className="mt-2 overflow-y-auto flex-1"
          aria-label="主导航"
        >
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={[
                  'flex items-center h-11 gap-3 transition-colors duration-150',
                  'border-l-2',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
                  sidebarOpen ? 'px-4' : 'px-4 lg:justify-center lg:px-0',
                  isActive
                    ? 'border-accent bg-[color-mix(in_oklch,var(--color-accent)_22%,transparent)] text-paper font-medium'
                    : 'border-transparent text-[color-mix(in_oklch,var(--color-paper)_70%,transparent)] hover:text-paper hover:bg-[color-mix(in_oklch,var(--color-paper)_10%,transparent)]',
                ].join(' ')}
                title={!sidebarOpen ? item.label : undefined}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span
                  className={[
                    'truncate',
                    !sidebarOpen ? 'lg:hidden' : '',
                  ].join(' ')}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* 版本信息 */}
        <div
          className={[
            'px-4 py-3 text-xs select-none',
            'text-[color-mix(in_oklch,var(--color-paper)_55%,transparent)]',
            !sidebarOpen ? 'lg:hidden' : '',
          ].join(' ')}
        >
          NASKTV v{__APP_VERSION__}
        </div>
      </aside>

      {/* Main content */}
      <div
        className={[
          'transition-all duration-200 ease-out',
          sidebarOpen ? 'lg:ml-64' : 'lg:ml-16',
        ].join(' ')}
      >
        {/* Top bar */}
        <header className="sticky top-0 z-20 h-16 flex items-center justify-between px-4 lg:px-6 bg-paper-2 border-b border-border">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebar(true)}
              className={[
                'lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md',
                'text-ink-2 hover:text-ink hover:bg-paper-3',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'transition-colors',
              ].join(' ')}
              aria-label="打开菜单"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold font-display text-ink">
              {currentLabel}
            </h2>
          </div>
          <button
            onClick={handleLogout}
            className={[
              'inline-flex items-center gap-2 h-9 px-3 rounded-md',
              'text-ink-2 hover:text-danger hover:bg-paper-3',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              'transition-colors',
            ].join(' ')}
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">退出登录</span>
          </button>
        </header>

        {/* Content */}
        <main className="p-4 lg:p-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
