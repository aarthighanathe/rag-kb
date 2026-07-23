/**
 * @file DesignSystem.tsx
 * @description Internal design-system showcase — Lab Notebook theme.
 *   Renders every component in all variants for visual QA. Route: /design-system.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useState } from 'react';
import {
  Button,
  Input,
  Badge,
  FileDropzone,
  CitationChip,
  ChatMessage,
  IndexCard,
  StreamingCursor,
  LoadingSpinner,
  Modal,
  EmptyState,
  ToastContainer,
  useToast,
} from '../design-system';
import {
  Upload, Search,
  AlertCircle, FileText, Trash2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-ds-16">
      <h2
        className="text-ds-xl font-display font-black text-ds-text-primary mb-ds-1 pb-ds-3 border-b border-ds-hairline"
        style={{ letterSpacing: '-0.02em' }}
      >
        {title}
      </h2>
      <div className="mt-ds-6">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-ds-6">
      <p className="text-ds-xs font-body text-ds-text-muted tracking-ds-wider uppercase mb-ds-3">{label}</p>
      <div className="flex flex-wrap items-center gap-ds-3">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Internal design-system showcase — /design-system.
 * Every component rendered in all variants for visual QA.
 */
export function DesignSystemShowcase(): React.JSX.Element {
  const { toasts, toast, dismiss } = useToast();
  const [inputValue, setInputValue] = useState('');
  const [modalOpen, setModalOpen]   = useState(false);
  const [streaming, setStreaming]   = useState(true);

  const [mockFiles] = useState([
    { id: '1', name: 'research-paper.pdf', progress: 72, status: 'uploading' as const },
    { id: '2', name: 'notes.txt',          progress: 100, status: 'done' as const },
    { id: '3', name: 'broken.docx',        progress: 0,   status: 'error' as const, error: 'File exceeds 10 MB limit' },
  ]);

  return (
    <div className="max-w-4xl mx-auto px-ds-6 py-ds-10 font-body">
      <header className="mb-ds-12">
        <p className="text-ds-xs font-mono text-ds-stamp tracking-ds-wider uppercase mb-ds-2">
          Internal · /design-system
        </p>
        <h1
          className="text-ds-3xl font-display font-black text-ds-text-primary leading-ds-tight"
          style={{ fontStyle: 'italic', letterSpacing: '-0.02em' }}
        >
          Lab Notebook
        </h1>
        <p className="text-ds-base font-body text-ds-text-secondary mt-ds-3 leading-ds-relaxed">
          Design system showcase — every component in all variants. Use for visual QA before shipping.
        </p>
      </header>

      {/* ── COLOR PALETTE ──────────────────────────────────────────────────── */}
      <Section title="Color Tokens">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-ds-3">
          {[
            ['Paper',     'bg-ds-base',      '#F7F5F0'],
            ['Surface',   'bg-ds-surface',   '#FFFFFF'],
            ['Card',      'bg-ds-elevated',  '#FCFBF8'],
            ['Hairline',  'bg-ds-hairline',  '#D8D4C8'],
            ['Stamp',     'bg-ds-stamp',     '#FF4D2E'],
            ['Archive',   'bg-ds-archive',   '#2D5A4A'],
            ['Highlight', 'bg-ds-highlight', '#FFE066'],
            ['Error',     'bg-ds-error',     '#C0392B'],
          ].map(([name, cls, hex]) => (
            <div key={name} className="flex flex-col gap-ds-2">
              <div className={`h-12 rounded-[2px] border border-ds-hairline ${cls}`} />
              <div>
                <p className="text-ds-xs font-body font-medium text-ds-text-primary">{name}</p>
                <p className="text-ds-xs font-mono text-ds-text-muted">{hex}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── TYPOGRAPHY ─────────────────────────────────────────────────────── */}
      <Section title="Typography">
        <div className="mb-ds-4">
          <p className="text-ds-xs font-body text-ds-text-muted uppercase tracking-ds-wider mb-ds-2">Fraunces (Display)</p>
          {(['3xl','2xl','xl','lg','base'] as const).map((size) => (
            <p
              key={size}
              className={`text-ds-${size} font-display font-black text-ds-text-primary leading-ds-tight mb-ds-2`}
              style={{ letterSpacing: '-0.02em' }}
            >
              {size} — The quick brown fox
            </p>
          ))}
        </div>
        <div className="h-px bg-ds-hairline my-ds-4" aria-hidden="true" />
        <div className="mb-ds-4">
          <p className="text-ds-xs font-body text-ds-text-muted uppercase tracking-ds-wider mb-ds-2">Space Grotesk (Body/UI)</p>
          <p className="text-ds-base font-body text-ds-text-secondary leading-ds-relaxed">
            Reading long-form research output comfortably at body size. Space Grotesk balances legibility with personality.
          </p>
        </div>
        <div className="h-px bg-ds-hairline my-ds-4" aria-hidden="true" />
        <div>
          <p className="text-ds-xs font-body text-ds-text-muted uppercase tracking-ds-wider mb-ds-2">Space Mono (Data/Code)</p>
          <p className="text-ds-sm font-mono text-ds-archive">
            0x1A2B3C4D · chunk.id=42 · similarity=0.94 · tokens=384
          </p>
        </div>
      </Section>

      {/* ── BUTTON ─────────────────────────────────────────────────────────── */}
      <Section title="Button">
        <Row label="Variants">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </Row>
        <Row label="Sizes">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Row>
        <Row label="With Icons">
          <Button iconLeft={<Upload size={15} />}>Upload</Button>
          <Button variant="secondary" iconRight={<Search size={15} />}>Search</Button>
          <Button variant="ghost" iconOnly iconLeft={<Trash2 size={15} />} aria-label="Delete" />
        </Row>
        <Row label="States">
          <Button loading>Uploading…</Button>
          <Button disabled>Disabled</Button>
        </Row>
      </Section>

      {/* ── INPUT ──────────────────────────────────────────────────────────── */}
      <Section title="Input">
        <div className="grid gap-ds-6 max-w-md">
          <Input
            label="Document search"
            placeholder="Search documents…"
            helperText="Type to filter the document list"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            iconLeft={<Search size={14} />}
            clearable
            onClear={() => setInputValue('')}
          />
          <Input
            label="Short description"
            placeholder="Describe this document…"
            maxLength={80}
            showCharCount
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <Input
            label="Error state"
            placeholder="Enter value"
            errorMessage="This field is required"
            iconLeft={<AlertCircle size={14} />}
            defaultValue="invalid@"
          />
          <Input
            label="Success state"
            variant="success"
            defaultValue="valid@email.com"
            helperText="Looks good!"
          />
        </div>
      </Section>

      {/* ── BADGE ──────────────────────────────────────────────────────────── */}
      <Section title="Badge">
        <Row label="Variants (md)">
          <Badge variant="default">Default</Badge>
          <Badge variant="success">Ready</Badge>
          <Badge variant="warning">Processing</Badge>
          <Badge variant="danger">Failed</Badge>
          <Badge variant="citation">Source</Badge>
        </Row>
        <Row label="With dot indicator">
          <Badge variant="success" dot>Ready</Badge>
          <Badge variant="warning" dot>Processing</Badge>
          <Badge variant="danger"  dot>Failed</Badge>
        </Row>
        <Row label="Small size">
          <Badge size="sm" variant="default">PDF</Badge>
          <Badge size="sm" variant="success">Ready</Badge>
          <Badge size="sm" variant="citation" dot>Cited</Badge>
        </Row>
      </Section>

      {/* ── INDEX CARD (Signature component) ───────────────────────────────── */}
      <Section title="IndexCard (Signature Element)">
        <p className="text-ds-xs font-body text-ds-text-muted mb-ds-4">
          Click or press Enter/Space to flip. Each card has a deterministic rotation seeded by document name + index.
          The first card (index 0) shows a paperclip.
        </p>
        <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <IndexCard
            documentName="attention-is-all-you-need.pdf"
            chunkText="We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely."
            relevanceScore={0.96}
            chunkRef="p.1"
            index={0}
          />
          <IndexCard
            documentName="survey-of-llms.pdf"
            chunkText="Large Language Models have demonstrated remarkable few-shot learning capabilities across diverse NLP tasks, challenging the paradigm of task-specific fine-tuning."
            relevanceScore={0.72}
            chunkRef="§3.2"
            index={1}
          />
          <IndexCard
            documentName="rag-paper.pdf"
            chunkText="Retrieval-Augmented Generation combines parametric memory in the LLM weights with non-parametric memory in a dense vector store, improving factual accuracy."
            relevanceScore={0.45}
            chunkRef="p.7"
            index={2}
          />
        </div>
      </Section>

      {/* ── LOADING SPINNER ─────────────────────────────────────────────────── */}
      <Section title="LoadingSpinner">
        <Row label="Sizes">
          <LoadingSpinner size="sm" />
          <LoadingSpinner size="md" />
          <LoadingSpinner size="lg" />
        </Row>
        <Row label="Colors">
          <LoadingSpinner color="indigo" />
          <LoadingSpinner color="green" />
          <div className="bg-ds-stamp p-ds-2 rounded-[2px]">
            <LoadingSpinner color="white" />
          </div>
        </Row>
      </Section>

      {/* ── STREAMING CURSOR ────────────────────────────────────────────────── */}
      <Section title="StreamingCursor">
        <Row label="Active">
          <p className="font-body text-ds-base text-ds-text-primary">
            Composing answer<StreamingCursor />
          </p>
        </Row>
        <Row label="Controls">
          <Button size="sm" variant="secondary" onClick={() => setStreaming((s) => !s)}>
            {streaming ? 'Stop streaming' : 'Start streaming'}
          </Button>
          <p className="font-body text-ds-base text-ds-text-primary">
            The answer is 42<StreamingCursor active={streaming} />
          </p>
        </Row>
      </Section>

      {/* ── CITATION CHIP ───────────────────────────────────────────────────── */}
      <Section title="CitationChip">
        <p className="text-ds-xs font-body text-ds-text-muted mb-ds-3">
          Hover the badge to see the string-line connector. Click to expand the source panel.
        </p>
        <Row label="Relevance scores">
          <CitationChip
            documentName="research-2024.pdf"
            chunkRef="p.14"
            relevanceScore={0.94}
            fullText="This is the full chunk text that will be shown in the side panel when the user clicks the citation."
            index={0}
          />
          <CitationChip documentName="notes.txt" chunkRef="§3" relevanceScore={0.61} fullText="Medium relevance chunk content." index={1} />
          <CitationChip documentName="old-docs.md" chunkRef="p.2" relevanceScore={0.27} index={2} />
        </Row>
      </Section>

      {/* ── CHAT MESSAGE ────────────────────────────────────────────────────── */}
      <Section title="ChatMessage">
        <div className="flex flex-col gap-ds-6 max-w-2xl">
          <ChatMessage
            role="user"
            content="What does the paper say about transformer attention mechanisms?"
            timestamp={new Date().toISOString()}
          />
          <ChatMessage
            role="assistant"
            content="Transformer attention mechanisms use scaled dot-product attention where queries, keys, and values are projected from the input. The scaling factor 1/√dk prevents vanishing gradients."
            citations={[
              { id: 'c1', documentName: 'attention-paper.pdf', chunkRef: 'p.4', relevanceScore: 0.96, fullText: 'Scaled dot-product attention: Attention(Q,K,V) = softmax(QKᵀ/√dk)V' },
              { id: 'c2', documentName: 'survey.pdf', chunkRef: 'p.12', relevanceScore: 0.72 },
            ]}
            timestamp={new Date().toISOString()}
          />
          <ChatMessage
            role="assistant"
            content="Streaming response in progress…"
            streaming={true}
          />
        </div>
      </Section>

      {/* ── FILE DROPZONE ───────────────────────────────────────────────────── */}
      <Section title="FileDropzone">
        <div className="max-w-xl">
          <FileDropzone
            files={mockFiles}
            onFiles={(_f) => {/* console handled by parent */}}
            onRemove={(_id) => {/* console handled by parent */}}
            maxSizeBytes={10 * 1024 * 1024}
          />
        </div>
      </Section>

      {/* ── EMPTY STATE ─────────────────────────────────────────────────────── */}
      <Section title="EmptyState">
        <div className="border border-ds-hairline rounded-[2px]">
          <EmptyState
            icon={<FileText size={36} />}
            title="No documents yet"
            description="Upload a PDF, DOCX, TXT, or Markdown file to get started."
            action={<Button iconLeft={<Upload size={15} />}>Upload your first document</Button>}
          />
        </div>
      </Section>

      {/* ── MODAL ───────────────────────────────────────────────────────────── */}
      <Section title="Modal">
        <Button onClick={() => setModalOpen(true)}>Open Modal</Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Confirm removal"
          subtitle="This action cannot be undone."
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="danger"    onClick={() => setModalOpen(false)}>Remove document</Button>
            </>
          }
        >
          <p className="text-ds-base font-body text-ds-text-secondary leading-ds-relaxed">
            Are you sure you want to remove <strong className="text-ds-text-primary font-medium">research-paper.pdf</strong>?
            All embeddings and chat history referencing this document will also be removed.
          </p>
        </Modal>
      </Section>

      {/* ── TOAST ───────────────────────────────────────────────────────────── */}
      <Section title="Toast">
        <Row label="Trigger toasts">
          <Button variant="secondary" size="sm" onClick={() => toast('Document filed successfully', { variant: 'success', description: 'Processing will begin shortly.' })}>
            Success
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toast('Upload failed — file too large', { variant: 'error' })}>
            Error
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toast('Queue is experiencing high load', { variant: 'warning' })}>
            Warning
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toast('Embedding model updated to v2', { variant: 'info' })}>
            Info
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toast('Persistent toast', { duration: 0, variant: 'info', description: 'This will not auto-dismiss.' })}>
            Persistent
          </Button>
        </Row>
      </Section>

      {/* ── SHADOWS ─────────────────────────────────────────────────────────── */}
      <Section title="Shadows">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-ds-4">
          {[
            { label: 'ds-sm',      cls: 'shadow-ds-sm'      },
            { label: 'ds-md',      cls: 'shadow-ds-md'      },
            { label: 'ds-lifted',  cls: 'shadow-ds-lifted'  },
            { label: 'ds-stamp',   cls: 'shadow-ds-stamp'   },
          ].map(({ label, cls }) => (
            <div key={label} className={`h-14 rounded-[2px] bg-ds-card border border-ds-hairline ${cls} flex items-center justify-center`}>
              <p className="text-ds-xs font-mono text-ds-text-muted">{label}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Toast portal */}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
