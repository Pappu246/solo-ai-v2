import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer, Sparkles, Trash2, FileDown, ImagePlus, Workflow } from 'lucide-react';
import { Button, Spinner, useToast } from '../ui';
import { cn } from '../../lib/cn';
import { useT, getLanguage } from '../../lib/i18n';
import {
  buildDocumentHtml,
  downloadPdf,
  printDocument,
  documentFilename,
  type PdfTemplate,
  type PdfPage,
  type PdfFont,
  PDF_FONTS,
  PDF_PAGES,
} from '../../lib/pdfDocument';

const ACCENTS = ['#4f46e5', '#0ea5e9', '#059669', '#dc2626', '#7c3aed', '#b45309', '#111827'];

const SAMPLE = `# Meeting notes

A short **markdown** document to show how the PDF generator handles formatting.

## Agenda

1. Review the quarterly numbers
2. Plan the next release
3. Confirm owners and deadlines

## Highlights

> Keep this short and factual so the PDF stays readable.

| Item | Owner | Status |
| --- | --- | --- |
| Migration | Priya | Done |
| Launch | Arjun | In progress |

\`\`\`ts
const total = items.reduce((sum, i) => sum + i.cost, 0);
\`\`\`

The total is ${'$'}{total}. See [the docs](https://example.com) for details.`;

const MERMAID_SAMPLE = '```mermaid\ngraph LR\n  A[Idea] --> B[Write]\n  B --> C{Review?}\n  C -->|Yes| D[Publish]\n  C -->|No| B\n```';

/** Turn pasted text or markdown into a polished, print-ready PDF. */
export function PdfTool() {
  const tr = useT();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [footer, setFooter] = useState('');
  const [page, setPage] = useState<PdfPage>('a4');
  const [margin, setMargin] = useState(16);
  const [font, setFont] = useState<PdfFont>('sans');
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const insertAtCursor = (snippet: string) => {
    const ta = textareaRef.current;
    if (!ta) { setText(t => t + snippet); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setText(text.slice(0, start) + snippet + text.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.selectionStart = ta.selectionEnd = pos;
    });
  };

  const addImage = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: tr('Please choose an image file.'), tone: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      insertAtCursor(`\n![${file.name.replace(/[[\]]/g, '')}](${dataUrl})\n`);
    };
    reader.onerror = () => toast({ title: tr('Could not read that image.'), tone: 'error' });
    reader.readAsDataURL(file);
  };

  const template: PdfTemplate = useMemo(
    () => ({ page, margin, font, accent, title, subtitle, footer }),
    [page, margin, font, accent, title, subtitle, footer],
  );

  const lang = getLanguage();

  // Live preview of the exact document that will be printed.
  useEffect(() => {
    let active = true;
    setLoading(true);
    buildDocumentHtml(text, template, lang)
      .then(html => { if (active) setPreview(html); })
      .catch(() => { if (active) setPreview(''); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [text, template, lang]);

  const runDownload = async () => {
    if (!text.trim()) { toast({ title: tr('Add some text first.'), tone: 'error' }); return; }
    setLoading(true);
    try {
      await downloadPdf(text, template, documentFilename(title || 'document', 'pdf'), lang);
      toast({ title: tr('PDF downloaded'), tone: 'success' });
    } catch {
      toast({ title: tr('Could not build the PDF. Try Print instead.'), tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const runPrint = async () => {
    if (!text.trim()) { toast({ title: tr('Add some text first.'), tone: 'error' }); return; }
    setLoading(true);
    try {
      await printDocument(text, template, lang);
    } catch {
      toast({ title: tr('Could not open the print dialog.'), tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    setText(''); setTitle(''); setSubtitle(''); setFooter('');
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileDown className="w-4 h-4 text-accent" />
          <h1 className="text-base font-semibold">{tr('PDF & Documents')}</h1>
        </div>
        <p className="text-xs text-fg-subtle mt-1">{tr('Any text, images and diagrams — turn them into a polished PDF.')}</p>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 overflow-hidden">
        {/* Editor */}
        <div className="flex flex-col min-h-0 border border-border rounded-lg bg-surface overflow-hidden">
          <div className="p-3 space-y-3 border-b border-border">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{tr('Title')}</span>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Untitled document"
                className="mt-1 w-full rounded-md border border-border bg-canvas px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{tr('Subtitle')}</span>
                <input
                  value={subtitle}
                  onChange={e => setSubtitle(e.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-md border border-border bg-canvas px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{tr('Footer')}</span>
                <input
                  value={footer}
                  onChange={e => setFooter(e.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-md border border-border bg-canvas px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-xs">
                <span className="text-fg-subtle">{tr('Page')}</span>
                <select value={page} onChange={e => setPage(e.target.value as PdfPage)}
                  className="rounded-md border border-border bg-canvas px-2 py-1 text-xs">
                  {PDF_PAGES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs">
                <span className="text-fg-subtle">{tr('Margin')}</span>
                <select value={margin} onChange={e => setMargin(Number(e.target.value))}
                  className="rounded-md border border-border bg-canvas px-2 py-1 text-xs">
                  {[8, 12, 16, 20, 24].map(m => <option key={m} value={m}>{m} mm</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs">
                <span className="text-fg-subtle">{tr('Font')}</span>
                <select value={font} onChange={e => setFont(e.target.value as PdfFont)}
                  className="rounded-md border border-border bg-canvas px-2 py-1 text-xs">
                  {PDF_FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </label>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle ml-auto">{tr('Accent')}</span>
              <div className="flex items-center gap-1">
                {ACCENTS.map(c => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => setAccent(c)}
                    className={cn('h-5 w-5 rounded-full ring-offset-2 ring-offset-surface transition', accent === c ? 'ring-2 ring-fg' : '')}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            spellCheck={false}
            placeholder={'# Your document\n\nWrite or paste text, markdown, an image, or a ```mermaid diagram…'}
            className="flex-1 min-h-0 w-full resize-none border-0 bg-transparent p-3.5 text-sm leading-relaxed focus:outline-none placeholder:text-fg-subtle"
          />
          <div className="flex items-center gap-2 border-t border-border p-2">
            <Button variant="primary" size="sm" onClick={runDownload} disabled={loading || !text.trim()} leftIcon={<Download className="w-3.5 h-3.5" />}>
              {tr('Download PDF')}
            </Button>
            <Button variant="secondary" size="sm" onClick={runPrint} disabled={loading || !text.trim()} leftIcon={<Printer className="w-3.5 h-3.5" />}>
              {tr('Print')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => imageInputRef.current?.click()} leftIcon={<ImagePlus className="w-3.5 h-3.5" />}>
              {tr('Add image')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => insertAtCursor(`\n${MERMAID_SAMPLE}\n`)} leftIcon={<Workflow className="w-3.5 h-3.5" />}>
              {tr('Add diagram')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setText(SAMPLE)} leftIcon={<Sparkles className="w-3.5 h-3.5" />}>
              {tr('Insert sample')}
            </Button>
            <Button variant="ghost" size="sm" onClick={clearAll} disabled={!text && !title} leftIcon={<Trash2 className="w-3.5 h-3.5" />}>
              {tr('Clear')}
            </Button>
            {loading && <Spinner className="ml-auto w-4 h-4" />}
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              const files = e.target.files;
              if (files) for (const f of files) addImage(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* Live preview */}
        <div className="flex flex-col min-h-0 border border-border rounded-lg bg-surface overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{tr('Preview')}</span>
            <span className="text-[11px] text-fg-subtle ml-auto">{documentFilename(title || 'document', 'pdf')}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-fg-subtle/10 p-4">
            <div className="mx-auto w-full max-w-[210mm] rounded-md bg-white shadow-lg">
              <iframe
                ref={previewFrame}
                title="Document preview"
                srcDoc={preview}
                className="block w-full h-[70vh] border-0 bg-white"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
