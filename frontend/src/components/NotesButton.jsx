import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/client';

export default function NotesButton({ accountId, siteUrl, hasNote, onNoteChange }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef(null);
  const popoverRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Lazy load note on open
  useEffect(() => {
    if (!open || loaded) return;
    api.get(`/api/notes/${accountId}/${encodeURIComponent(siteUrl)}`)
      .then(r => { setContent(r.data.content || ''); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [open, loaded, accountId, siteUrl]);

  // Auto-save with debounce
  const saveNote = useCallback((text) => {
    setSaving(true);
    setSaved(false);
    api.put(`/api/notes/${accountId}/${encodeURIComponent(siteUrl)}`, { content: text })
      .then(() => {
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        if (onNoteChange) onNoteChange();
      })
      .catch(() => setSaving(false));
  }, [accountId, siteUrl, onNoteChange]);

  const handleChange = (e) => {
    const val = e.target.value;
    setContent(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => saveNote(val), 800);
  };

  // Use hasNote prop (from bulk list) OR local loaded content
  const showIndicator = hasNote || (loaded && content.length > 0);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 text-xs transition ${
          showIndicator
            ? 'text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300'
            : 'text-gray-400 hover:text-blue-600 dark:hover:text-blue-400'
        }`}
        title="Notes"
      >
        <svg className="w-3.5 h-3.5" fill={showIndicator ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Notes
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 p-3">
          {!loaded ? (
            <div className="text-xs text-gray-400 text-center py-4">Loading...</div>
          ) : (
            <>
              <textarea
                value={content}
                onChange={handleChange}
                placeholder="Add notes about this site..."
                className="w-full h-28 text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 dark:focus:ring-blue-900 resize-none placeholder:text-gray-400"
                autoFocus
              />
              <div className="flex justify-end mt-1.5">
                {saving && <span className="text-[11px] text-gray-400">Saving...</span>}
                {saved && <span className="text-[11px] text-green-500">Saved</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
