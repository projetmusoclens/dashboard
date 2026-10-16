import React, { useState, useMemo } from 'react';
import { Search, Heart, Eye, Repeat2 } from 'lucide-react';
import { Post, SortKey } from '../types';
import PostCard from './PostCard';

interface PostsTabProps {
  posts: Post[];
  onSelectPost: (post: Post) => void;
  selectedPostId?: string;
}

const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ReactNode }[] = [
  { key: 'likes', label: 'Likes', icon: <Heart size={12} /> },
  { key: 'views', label: 'Vues', icon: <Eye size={12} /> },
  { key: 'reposts', label: 'Reposts', icon: <Repeat2 size={12} /> },
];

const PostsTab: React.FC<PostsTabProps> = ({ posts, onSelectPost, selectedPostId }) => {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('likes');
  const [currentPage, setCurrentPage] = useState(1);
  const postsPerPage = 20;

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return [...posts]
      .filter(p => !q || p.text.toLowerCase().includes(q) || p.author_handle.toLowerCase().includes(q) || p.matched_keywords.some(k => k.includes(q)))
      .sort((a, b) => (b.engagement[sortKey] || 0) - (a.engagement[sortKey] || 0));
  }, [posts, query, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / postsPerPage));
  const currentPosts = filtered.slice((currentPage - 1) * postsPerPage, currentPage * postsPerPage);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [query, sortKey, posts.length]);

  const getVisiblePageNumbers = () => {
    const pages: number[] = [];
    const delta = 2;
    const left = Math.max(1, currentPage - delta);
    const right = Math.min(totalPages, currentPage + delta);

    if (left > 1) {
      pages.push(1);
      if (left > 2) pages.push(-1);
    }

    for (let i = left; i <= right; i += 1) {
      pages.push(i);
    }

    if (right < totalPages) {
      if (right < totalPages - 1) pages.push(-1);
      pages.push(totalPages);
    }

    return pages;
  };

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) return;
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher par auteur, texte ou mot-clé..."
            style={{
              width: '100%',
              paddingLeft: 32,
              paddingRight: 12,
              paddingTop: 8,
              paddingBottom: 8,
              fontSize: 13,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--input-bg)',
              color: 'var(--text-primary)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 500,
                border: '1px solid',
                borderColor: sortKey === opt.key ? '#1d9e75' : 'var(--border)',
                borderRadius: 8,
                background: sortKey === opt.key ? '#1d9e75' : 'transparent',
                color: sortKey === opt.key ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {filtered.length} post{filtered.length > 1 ? 's' : ''} — triés par <strong style={{ color: 'var(--text-secondary)' }}>{sortKey}</strong>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {currentPosts.map(post => (
          <PostCard
            key={post.post_id}
            post={post}
            selected={post.post_id === selectedPostId}
            onClick={() => onSelectPost(post)}
          />
        ))}
        {currentPosts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: 14 }}>
            Aucun post trouvé pour « {query} »
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 18, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            style={{
              padding: '0.55rem 0.9rem', borderRadius: 8, border: '1px solid var(--border)', background: currentPage === 1 ? 'var(--disabled-bg)' : 'var(--card-bg)',
              color: currentPage === 1 ? 'var(--text-disabled)' : 'var(--text-primary)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
            }}
          >
            Préc.
          </button>
          {getVisiblePageNumbers().map((page, index) => (
            <React.Fragment key={`${page}-${index}`}>
              {page === -1 ? (
                <span style={{ padding: '0.55rem 0.8rem', color: 'var(--text-muted)' }}>...</span>
              ) : (
                <button
                  type="button"
                  onClick={() => handlePageChange(page)}
                  style={{
                    padding: '0.55rem 0.9rem', borderRadius: 8, border: page === currentPage ? '1px solid #1d9e75' : '1px solid var(--border)',
                    background: page === currentPage ? '#1d9e75' : 'var(--card-bg)', color: page === currentPage ? '#fff' : 'var(--text-primary)',
                    cursor: page === currentPage ? 'default' : 'pointer'
                  }}
                  disabled={page === currentPage}
                >
                  {page}
                </button>
              )}
            </React.Fragment>
          ))}
          <button
            type="button"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            style={{
              padding: '0.55rem 0.9rem', borderRadius: 8, border: '1px solid var(--border)', background: currentPage === totalPages ? 'var(--disabled-bg)' : 'var(--card-bg)',
              color: currentPage === totalPages ? 'var(--text-disabled)' : 'var(--text-primary)', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
            }}
          >
            Suiv.
          </button>
        </div>
      )}
    </div>
  );
};

export default PostsTab;
