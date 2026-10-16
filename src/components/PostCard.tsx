import React, { useMemo, useState } from 'react';
import { Heart, Repeat2, MessageCircle, Eye, ZoomIn, X } from 'lucide-react';
import { Post } from '../types';
import { fmtNum } from '../utils/format';

interface PostCardProps {
  post: Post;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

const KEYWORD_COLORS: Record<string, { bg: string; color: string }> = {
  fifaworldcup:           { bg: '#e6f1fb', color: '#185fa5' },
  azteca:                 { bg: '#e1f5ee', color: '#0f6e56' },
  'opening ceremony':     { bg: '#faeeda', color: '#854f0b' },
  worldcup2026:           { bg: '#eeedfe', color: '#534ab7' },
  mexrsa:                 { bg: '#faece7', color: '#993c1d' },
  'ceremonia de apertura':{ bg: '#fbeaf0', color: '#993556' },
  mexico2026:             { bg: '#eaf3de', color: '#3b6d11' },
};

const PostCard: React.FC<PostCardProps> = ({ post, selected, onClick, compact }) => {
  const [zoomMedia, setZoomMedia] = useState<{ url: string; isVideo: boolean } | null>(null);
  const mediaItems = useMemo(() => {
    const extracted = Array.from(post.text.matchAll(/https?:\/\/[^\s<>]+\.(?:png|jpe?g|gif|webp|mp4|webm|mov)(?:\?[^\s<>]*)?/gi), match => match[0]);
    const urls = [post.image_url, post.media_url, ...(post.image_urls || []), ...(post.media_urls || []), ...(post.video_urls || []), ...extracted];
    return Array.from(new Set(urls.filter((url): url is string => Boolean(url)))).map(url => ({
      url,
      isVideo: /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(url),
    }));
  }, [post.image_url, post.image_urls, post.media_url, post.media_urls, post.video_urls, post.text]);
  const kw = post.matched_keywords[0] || '';
  const kwStyle = KEYWORD_COLORS[kw] || { bg: '#f1efe8', color: '#5f5e5a' };

  return (
    <>
      <div
        onClick={onClick}
        style={{
        background: 'var(--card-bg)',
        border: `1px solid ${selected ? '#1d9e75' : 'var(--border)'}`,
        borderRadius: 12,
        padding: compact ? '0.75rem 1rem' : '1rem 1.25rem',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: selected ? '0 0 0 2px rgba(29,158,117,0.15)' : 'none',
      }}
    >
      {kw && (
        <span style={{
          display: 'inline-block',
          fontSize: 10,
          fontWeight: 600,
          padding: '2px 8px',
          borderRadius: 6,
          background: kwStyle.bg,
          color: kwStyle.color,
          marginBottom: 6,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          #{kw}
        </span>
      )}
      <div style={{ fontWeight: 600, fontSize: compact ? 12 : 13, color: 'var(--text-primary)', marginBottom: 4 }}>
        @{post.author_handle}
      </div>
      <div style={{
        fontSize: compact ? 12 : 13,
        color: 'var(--text-secondary)',
        lineHeight: 1.55,
        marginBottom: compact ? 6 : 10,
        display: '-webkit-box',
        WebkitLineClamp: compact ? 2 : 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
      }}>
        {post.text}
      </div>
      {mediaItems.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 8, marginBottom: 12 }}>
          {mediaItems.map((media, index) => (
            <div key={media.url} style={{ position: 'relative', minWidth: 0, overflow: 'hidden', borderRadius: 8, background: 'rgba(80, 90, 100, 0.08)' }}>
              {media.isVideo ? (
                <video src={media.url} controls preload="metadata" aria-label={`Vidéo ${index + 1}`} onClick={(event) => event.stopPropagation()} style={{ display: 'block', width: '100%', maxHeight: 260 }} />
              ) : (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setZoomMedia(media);
                  }}
                  aria-label={`Agrandir le média ${index + 1}`}
                  style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in' }}
                >
                  <img src={media.url} alt={`Média ${index + 1}`} loading="lazy" style={{ display: 'block', width: '100%', maxHeight: 260, objectFit: 'contain' }} />
                  <span style={{ position: 'absolute', right: 8, bottom: 8, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.68)', color: '#fff', fontSize: 11, fontWeight: 600 }}>
                    <ZoomIn size={13} /> Agrandir
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {[
          { icon: <Heart size={11} />, val: post.engagement.likes },
          { icon: <Repeat2 size={11} />, val: post.engagement.reposts },
          { icon: <MessageCircle size={11} />, val: post.engagement.replies },
          { icon: <Eye size={11} />, val: post.engagement.views },
        ].map((item, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
            {item.icon} {fmtNum(item.val)}
          </span>
        ))}
      </div>
    </div>

    {zoomMedia && !zoomMedia.isVideo && (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
          background: 'rgba(0, 0, 0, 0.82)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
        onClick={() => setZoomMedia(null)}
      >
        <div style={{ position: 'relative', maxWidth: '95%', maxHeight: '95%' }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setZoomMedia(null)}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              padding: 10,
              borderRadius: 999,
              border: 'none',
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
              cursor: 'pointer',
              zIndex: 2,
            }}
          >
            <X size={18} />
          </button>
          <img
            src={zoomMedia.url}
            alt="Agrandie"
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              borderRadius: 16,
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            }}
          />
        </div>
      </div>
    )}
  </>
  );
};

export default PostCard;
