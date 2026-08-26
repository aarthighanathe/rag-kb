/**
 * @file DeleteModal.tsx
 * @description Delete confirmation modal for the Documents page — confirms removal
 *   of one or more documents before calling through to the delete action.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React from 'react';
import type { DocumentRecord } from '../../services/api';
import { fmtDateTime } from '../../utils/documentFormatters';
import { Button } from './Button';
import { Modal } from './Modal';

/**
 * Confirmation modal shown before deleting one or more documents.
 * @param targets - Documents pending deletion
 * @param onConfirm - Confirms and performs the deletion
 * @param onCancel - Dismisses the modal without deleting
 * @param isDeleting - True while the deletion request is in flight
 * @returns Delete confirmation modal element
 */
export function DeleteModal({
  targets,
  onConfirm,
  onCancel,
  isDeleting,
}: {
  targets: DocumentRecord[];
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isDeleting: boolean;
}): React.JSX.Element {
  return (
    <Modal
      open
      onClose={onCancel}
      title={targets.length === 1 ? 'Remove document?' : `Remove ${targets.length} documents?`}
      subtitle="This action cannot be undone."
      preventBackdropClose={isDeleting}
      footer={
        <>
          <Button
            data-testid="cancel-delete"
            variant="secondary"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            data-testid="confirm-delete"
            variant="danger"
            loading={isDeleting}
            onClick={() => void onConfirm()}
          >
            {isDeleting
              ? 'Removing…'
              : `Remove ${targets.length === 1 ? '1 document' : `${targets.length} documents`}`}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-1.5 text-ds-sm font-body text-ds-text-secondary max-h-40 overflow-y-auto">
        {targets.map((d) => (
          <li key={d.id} className="font-mono text-ds-xs">
            <span className="truncate block">· {d.filename}</span>
            <span className="text-ds-text-muted pl-3">
              {fmtDateTime(d.created_at)} · id {d.id.slice(0, 8)}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
