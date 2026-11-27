import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { ProjectChatMessage } from '../../../../types';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { Avatar } from '../../ui/Badges';

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};

export const ChatSection: React.FC = () => {
  const { projectId, chatMessages, setChatMessages, chatHasMore, loadOlderChat } = useProject();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const { currentUser, showToast } = useApp();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stick to the newest message as messages arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages[chatMessages.length - 1]?.id]);

  // Older messages are added above; keep the view where it was
  const showOlder = async () => {
    const el = scrollRef.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    setLoadingOlder(true);
    try {
      await loadOlderChat();
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    } catch (err: any) {
      showToast(err.message || 'Could not load older messages', 'error');
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await api.post<ProjectChatMessage>(`/api/projects/${projectId}/chat`, { text });
      setChatMessages((list) => [...list, msg]);
      setDraft('');
    } catch (err: any) {
      showToast(err.message || 'Failed to send message', 'error');
    } finally {
      setSending(false);
    }
  };

  let lastDay = '';
  let lastSender = '';

  return (
    <div className="max-w-3xl h-[calc(100dvh-260px)] min-h-[420px] flex flex-col border border-line rounded-lg overflow-hidden">
      <div ref={scrollRef} role="log" aria-live="polite" aria-label="Chat messages" className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">
        {chatHasMore && (
          <div className="flex justify-center mb-3">
            <button onClick={showOlder} disabled={loadingOlder} className="h-7 px-3 rounded-full border border-line text-meta text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-50">
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {chatMessages.length === 0 && <p className="text-sm text-fg-muted text-center py-10">No messages yet. Start the conversation.</p>}
        {chatMessages.map((msg) => {
          const day = dayLabel(msg.timestamp);
          const showDay = day !== lastDay;
          // Group consecutive messages from the same person
          const grouped = !showDay && lastSender === msg.senderId;
          lastDay = day;
          lastSender = msg.senderId;
          return (
            <React.Fragment key={msg.id}>
              {showDay && (
                <div className="flex items-center gap-3 my-4 first:mt-0 text-xs text-fg-faint" role="separator">
                  <div className="flex-1 h-px bg-line" />
                  {day}
                  <div className="flex-1 h-px bg-line" />
                </div>
              )}
              <div className={`group flex items-start gap-3 rounded-md px-1.5 -mx-1.5 hover:bg-subtle ${grouped ? 'py-0.5' : 'pt-2 pb-0.5'}`}>
                <div className="w-7 shrink-0">{!grouped && <Avatar src={msg.senderAvatar} name={msg.senderName} size={28} />}</div>
                <div className="flex-1 min-w-0">
                  {!grouped && (
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold text-fg">{msg.senderId === currentUser?.id ? 'You' : msg.senderName}</span>
                      <time className="text-xs text-fg-faint" dateTime={msg.timestamp}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </time>
                    </div>
                  )}
                  <div className="text-sm text-fg leading-relaxed whitespace-pre-wrap break-words">{msg.text}</div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="p-3 border-t border-line"
      >
        <div className="flex items-end gap-2 border border-line-strong rounded-lg px-3 py-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            rows={1}
            placeholder="Message the team"
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            className="flex-1 resize-none max-h-32 bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none py-0.5"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md bg-accent hover:bg-accent-hover disabled:bg-hover disabled:text-fg-faint text-on-accent transition-colors"
            aria-label="Send message"
          >
            <ArrowUp size={15} />
          </button>
        </div>
        <p className="text-xs text-fg-faint mt-1.5 px-1">Enter to send · Shift+Enter for a new line</p>
      </form>
    </div>
  );
};
