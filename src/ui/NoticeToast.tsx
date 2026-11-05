import { useEffect } from 'react';
import { useAppStore } from '../state/appStore';
import { CloseIcon } from './icons';

const AUTO_DISMISS_MS = 7000;

export function NoticeToast() {
  const notice = useAppStore((state) => state.notice);
  const dismiss = useAppStore((state) => state.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;

  return (
    <div
      key={notice.id}
      className={`toast toast--${notice.tone}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      <div>
        <p className="toast__title">{notice.title}</p>
        <p className="toast__body">{notice.body}</p>
      </div>
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={dismiss}>
        <CloseIcon width={16} height={16} />
      </button>
    </div>
  );
}
