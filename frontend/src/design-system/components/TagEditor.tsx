/**
 * @file TagEditor.tsx
 * @description Inline tag chip editor for a document — shown in the Documents page's
 *   expanded table row. Add/remove tags with the changes persisted immediately.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React, { useCallback, useState } from 'react';
import { Tag as TagIcon, X, Plus } from 'lucide-react';
import { Badge } from './Badge';
import { useRagStore } from '../../stores/ragStore';
import { useAppToast } from '../../contexts/ToastContext';
import type { DocumentRecord } from '../../services/api';

/**
 * Inline chip list with add/remove controls for a document's tags. Tag edits
 * are saved immediately via the store's `updateDocumentTags` action.
 * @param doc - Document whose tags are being edited
 * @returns Tag editor element
 */
export function TagEditor({ doc }: { doc: DocumentRecord }): React.JSX.Element {
  const updateDocumentTags = useRagStore((s) => s.updateDocumentTags);
  const { toast } = useAppToast();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const commit = useCallback(
    async (nextTags: string[]) => {
      setSaving(true);
      try {
        await updateDocumentTags(doc.id, nextTags);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update tags';
        toast(msg, { variant: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [doc.id, updateDocumentTags, toast],
  );

  const addTag = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || doc.tags.includes(trimmed) || doc.tags.length >= 20) {
      setDraft('');
      return;
    }
    setDraft('');
    void commit([...doc.tags, trimmed]);
  }, [draft, doc.tags, commit]);

  const removeTag = useCallback(
    (tag: string) => {
      void commit(doc.tags.filter((t) => t !== tag));
    },
    [doc.tags, commit],
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={`Tags for ${doc.filename}`}>
      <TagIcon size={11} className="text-ds-text-muted shrink-0" aria-hidden="true" />
      {doc.tags.map((tag) => (
        <Badge key={tag} variant="default" size="sm">
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            disabled={saving}
            aria-label={`Remove tag ${tag}`}
            className="ml-1 hover:text-ds-error transition-colors disabled:opacity-50"
          >
            <X size={9} aria-hidden="true" />
          </button>
        </Badge>
      ))}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="Add tag…"
          maxLength={40}
          disabled={saving || doc.tags.length >= 20}
          aria-label="New tag"
          className="text-[10px] font-mono px-1.5 py-0.5 border border-ds-hairline rounded-[2px] bg-ds-card text-ds-text-primary w-20 focus:outline-none focus:border-ds-stamp disabled:opacity-50"
        />
        <button
          type="button"
          onClick={addTag}
          disabled={saving || !draft.trim() || doc.tags.length >= 20}
          aria-label="Add tag"
          className="text-ds-text-muted hover:text-ds-stamp transition-colors disabled:opacity-30"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
