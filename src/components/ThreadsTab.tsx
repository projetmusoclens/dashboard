import React, { useState } from 'react';
import { Heart, Eye, Repeat2, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Thread, Post } from '../types';
import { fmtNum } from '../utils/format';

interface ThreadsTabProps {
  threads: Thread[];
  highlightedPost?: Post | null;
}

const ReplyItem: React.FC<{ reply: Post }> = ({ reply }) => (
  <div style={{
    borderLeft: '2px solid var(--border)',
    paddingLeft: 12,
    paddingTop: 6,
    paddingBottom: 6,
  }}>
    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)', marginBottom: 2 }}>
      @{reply.author_handle}
    </div>
    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 4 }}>
      {reply.text}
    </div>
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
        <Heart size={10} /> {fmtNum(reply.engagement.likes)}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
        <Eye size={10} /> {fmtNum(reply.engagement.views)}
      </span>
    </div>
  </div>
);

const ThreadCard: React.FC<{ thread: Thread; highlighted?: boolean }> = ({ thread, highlighted }) => {
  const [expanded, setExpanded] = useState(highlighted || false);

  return (
    <div style={{
      background: 'var(--card-bg)',
      border: `1px solid ${highlighted ? '#1d9e75' : 'var(--border)'}`,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: '1rem',
      boxShadow: highlighted ? '0 0 0 3px rgba(29,158,117,0.1)' : 'none',
    }}>
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
        {highlighted && (
          <div style={{
            display: 'inline-block',
            fontSize: 10, fontWeight: 600, padding: '2px 8px',
            borderRadius: 6, background: '#e1f5ee', color: '#0f6e56',
            marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            Post sélectionné
          </div>
        )}
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
          @{thread.parent.author_handle}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 10, whiteSpace: 'pre-wrap' }}>
          {thread.parent.text}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[
            { icon: <Heart size={12} />, val: thread.parent.engagement.likes, color: '#e34948' },
            { icon: <Repeat2 size={12} />, val: thread.parent.engagement.reposts, color: '#2a78d6' },
            { icon: <MessageCircle size={12} />, val: thread.parent.engagement.replies, color: '#eda100' },
            { icon: <Eye size={12} />, val: thread.parent.engagement.views, color: 'var(--text-muted)' },
          ].map((item, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: item.color, fontWeight: 500 }}>
              {item.icon} {fmtNum(item.val)}
            </span>
          ))}
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1.25rem',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--text-secondary)',
          fontWeight: 500,
        }}
      >
        <span>{thread.replies.length} réponse{thread.replies.length > 1 ? 's' : ''} dans la base</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div style={{ padding: '0 1.25rem 1rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {thread.replies
            .sort((a, b) => (b.engagement.likes || 0) - (a.engagement.likes || 0))
            .map(reply => (
              <ReplyItem key={reply.post_id} reply={reply} />
            ))}
        </div>
      )}
    </div>
  );
};

const ThreadsTab: React.FC<ThreadsTabProps> = ({ threads, highlightedPost }) => {
  const highlightedThread = highlightedPost
    ? threads.find(t => t.parent.post_id === highlightedPost.post_id || t.replies.some(reply => reply.post_id === highlightedPost.post_id))
    : null;

  const otherThreads = highlightedThread
    ? threads.filter(t => t !== highlightedThread)
    : threads;

  return (
    <div>
      {!highlightedPost && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
          Clique sur un post dans l'onglet <strong>Explorer</strong> pour voir ses réponses, ou consulte directement les threads les plus actifs ci-dessous.
        </p>
      )}

      {highlightedPost && !highlightedThread && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Aucun thread trouvé
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Le post sélectionné @{highlightedPost.author_handle} ne possède pas de relation reply_to_id exploitable dans les données actuelles.
          </div>
        </div>
      )}

      {highlightedThread && (
        <ThreadCard thread={highlightedThread} highlighted />
      )}

      {otherThreads.length > 0 ? (
        <>
          {highlightedThread && (
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '1.5rem 0 0.75rem' }}>
              Autres threads actifs
            </div>
          )}
          {otherThreads.map((thread, i) => (
            <ThreadCard key={i} thread={thread} />
          ))}
        </>
      ) : !highlightedPost && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Aucun thread disponible
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Le dataset actuel ne contient pas de threads. Ajoute des objets dans <code>dashboardData.threads</code> pour activer cette section.
          </div>
        </div>
      )}
    </div>
  );
};

export default ThreadsTab;
