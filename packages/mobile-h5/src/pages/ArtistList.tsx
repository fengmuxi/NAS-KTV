/* Hallmark · genre: editorial · theme: Garden · Catalogue · ArtistList page
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { artistsApi } from '../api/artists';
import BottomNav from '../components/BottomNav';
import Skeleton from '../components/Skeleton';
import type { Artist } from '@nasktv/shared';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');

const css = `
/* Hallmark · genre: editorial · theme: Garden · Catalogue · ArtistList page */
.al-letter-header {
  position: sticky;
  top: 0;
  z-index: var(--z-base);
  padding: var(--space-sm) 0;
  margin-bottom: var(--space-sm);
  background-color: color-mix(in oklab, var(--color-paper) 95%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--color-accent);
  letter-spacing: 0.02em;
  border-bottom: 1px solid var(--color-border);
  transition: color var(--dur-fast) var(--ease-out);
}

.al-artist-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-md);
  background-color: var(--color-paper-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  outline: none;
  min-height: 44px;
  min-width: 44px;
  transition: background-color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out),
              transform var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out);
}
.al-artist-card:hover {
  background-color: var(--color-paper-3);
  border-color: var(--color-accent-soft);
}
.al-artist-card:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
  border-color: var(--color-accent);
}
.al-artist-card:active {
  transform: scale(0.98);
  background-color: var(--color-accent-soft);
  border-color: var(--color-accent);
}
.al-artist-card:disabled,
.al-artist-card[data-disabled="true"] {
  opacity: 0.5;
  pointer-events: none;
  cursor: not-allowed;
}
.al-artist-card[data-state="loading"] {
  animation: al-card-pulse 1.5s var(--ease-in-out) infinite;
}
@keyframes al-card-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.al-artist-card[data-state="error"] {
  border-color: var(--color-danger);
}
.al-artist-card[data-state="success"] {
  border-color: var(--color-success);
}

.al-artist-name {
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--color-ink);
  line-height: 1.4;
}
.al-artist-count {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-ink-3);
  line-height: 1.5;
  margin-top: var(--space-xs);
}
.al-artist-arrow {
  color: var(--color-ink-3);
  flex-shrink: 0;
  transition: transform var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.al-artist-card:hover .al-artist-arrow {
  transform: translateX(2px);
  color: var(--color-accent);
}

.al-index-bar {
  position: fixed;
  right: 0;
  top: auto;
  bottom: calc(100px + env(safe-area-inset-bottom)); /* 位于底部导航上方，避免被遮挡 */
  transform: none;
  z-index: var(--z-dropdown);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-xs) var(--space-xs);
  background-color: color-mix(in oklab, var(--color-paper-2) 92%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-left: 1px solid var(--color-border);
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  box-shadow: -2px 0 8px oklch(20% 0.02 145 / 0.06);
  touch-action: none;
  max-height: calc(100vh - 150px);
  overflow-y: auto;
  scrollbar-width: none;
}
.al-index-bar::-webkit-scrollbar {
  display: none;
}

/* 歌手搜索框 */
.al-search {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  background-color: var(--color-paper-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: 0 var(--space-md);
  margin-top: var(--space-md);
  max-width: 440px; /* 限制宽度，避免在宽屏/横屏下过宽 */
  transition: border-color var(--dur-fast) var(--ease-out);
}
.al-search:focus-within {
  border-color: var(--color-accent);
}
.al-search-icon {
  color: var(--color-ink-3);
  flex-shrink: 0;
}
.al-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 10px 0;
  font-size: var(--text-sm);
  color: var(--color-ink);
  min-width: 0;
}
.al-search-input::placeholder {
  color: var(--color-ink-3);
}
.al-search-input::-webkit-search-cancel-button {
  display: none;
}
.al-index-letter {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 22px;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-ink-3);
  cursor: pointer;
  border-radius: var(--radius-sm);
  outline: none;
  transition: color var(--dur-fast) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out),
              transform var(--dur-fast) var(--ease-out);
  -webkit-user-select: none;
  user-select: none;
}
.al-index-letter:hover {
  color: var(--color-accent);
  background-color: var(--color-accent-soft);
}
.al-index-letter:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
  color: var(--color-accent);
}
.al-index-letter:active {
  transform: scale(0.9);
  color: var(--color-on-accent);
  background-color: var(--color-accent);
}
.al-index-letter[data-active="true"] {
  color: var(--color-on-accent);
  background-color: var(--color-accent);
  font-weight: 600;
  transform: scale(1.1);
}
.al-index-letter:disabled,
.al-index-letter[data-disabled="true"] {
  opacity: 0.3;
  pointer-events: none;
}

.al-group-section {
  scroll-margin-top: 60px;
}

.al-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.al-title-count {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-ink-3);
  font-weight: 400;
}
.al-empty-hint {
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--color-ink-3);
  text-align: center;
  padding: var(--space-3xl) 0;
}
.al-loading-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: 0 var(--space-xl);
}
.al-skeleton-card {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
  background-color: var(--color-paper-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}
.al-skeleton-avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  background-color: var(--color-paper-3);
  skeleton-pulse: true;
}
.al-skeleton-text {
  height: 14px;
  border-radius: var(--radius-sm);
  background-color: var(--color-paper-3);
}
`;

export default function ArtistList() {
  const navigate = useNavigate();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [searchKeyword, setSearchKeyword] = useState('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const result = await artistsApi.getArtists({ pageSize: 200 });
        setArtists(result.items);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // 歌手搜索：按名称模糊过滤（不区分大小写），过滤后字母分组随之收窄
  const searchQ = searchKeyword.trim().toLowerCase();
  const visibleArtists = searchQ
    ? artists.filter((a) => a.name.toLowerCase().includes(searchQ))
    : artists;

  const grouped = visibleArtists.reduce((acc, artist) => {
    const letter = (artist.firstLetter || '#').toUpperCase();
    if (!acc[letter]) acc[letter] = [];
    acc[letter].push(artist);
    return acc;
  }, {} as Record<string, Artist[]>);

  const sortedLetters = Object.keys(grouped).sort((a, b) => {
    if (a === '#') return -1;
    if (b === '#') return 1;
    return a.localeCompare(b);
  });

  useEffect(() => {
    if (loading || sortedLetters.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const letter = entry.target.getAttribute('data-letter');
            if (letter) setActiveLetter(letter);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    const obs = observerRef.current;
    sortedLetters.forEach(letter => {
      const el = sectionRefs.current[letter];
      if (el) obs.observe(el);
    });

    return () => { obs.disconnect(); };
  }, [loading, sortedLetters]);

  const scrollToLetter = useCallback((letter: string) => {
    const el = sectionRefs.current[letter];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveLetter(letter);
    }
  }, []);

  const handleArtistClick = (id: number) => {
    navigate(`/artist/${id}`);
  };

  return (
    <div className="min-h-screen bg-paper pb-20" style={{ paddingBottom: 'calc(100px + env(safe-area-inset-bottom))' }}>
      <style>{css}</style>

      <div style={{ padding: 'var(--space-xl)', paddingTop: 'calc(env(safe-area-inset-top) + var(--space-2xl))', paddingRight: 'calc(var(--space-xl) + 44px)' }}>
        <div className="al-title-row">
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            color: 'var(--color-ink)',
            fontWeight: 400,
            lineHeight: 1.2,
          }}>
            歌手
          </h1>
          {!loading && (
            <span className="al-title-count">{artists.length} 位</span>
          )}
        </div>

        <div className="al-search">
          <Search size={16} strokeWidth={1.8} className="al-search-icon" />
          <input
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索歌手..."
            type="search"
            className="al-search-input"
            aria-label="搜索歌手"
          />
        </div>
      </div>

      {loading ? (
        <div className="al-loading-wrap">
          <Skeleton lines={6} />
        </div>
      ) : sortedLetters.length === 0 ? (
        <p className="al-empty-hint">{searchQ ? '未找到相关歌手' : '暂无歌手数据'}</p>
      ) : (
        <>
          <div style={{ paddingLeft: 'var(--space-xl)', paddingRight: 'calc(var(--space-xl) + 44px)' }}>
            {sortedLetters.map(letter => (
              <div
                key={letter}
                ref={el => { sectionRefs.current[letter] = el; }}
                data-letter={letter}
                className="al-group-section"
                style={{ marginBottom: 'var(--space-xl)' }}
              >
                <h2 className="al-letter-header">{letter}</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                  {grouped[letter].map(artist => (
                    <button
                      key={artist.id}
                      onClick={() => handleArtistClick(artist.id)}
                      className="al-artist-card"
                      role="link"
                      tabIndex={0}
                      aria-label={`${artist.name}${artist.songCount !== undefined ? `，${artist.songCount} 首歌曲` : ''}`}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p className="al-artist-name">{artist.name}</p>
                        {artist.songCount !== undefined && (
                          <p className="al-artist-count">{artist.songCount} 首歌曲</p>
                        )}
                      </div>
                      <span className="al-artist-arrow" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {!searchQ && (
          <nav className="al-index-bar" role="navigation" aria-label="字母索引">
            {ALPHABET.map(letter => {
              const exists = !!grouped[letter];
              return (
                <button
                  key={letter}
                  className="al-index-letter"
                  data-active={activeLetter === letter}
                  disabled={!exists}
                  onClick={() => exists && scrollToLetter(letter)}
                  aria-label={`跳转到 ${letter}`}
                  tabIndex={exists ? 0 : -1}
                >
                  {letter === '#' ? '#' : letter}
                </button>
              );
            })}
          </nav>
          )}
        </>
      )}

      <BottomNav />
    </div>
  );
}
