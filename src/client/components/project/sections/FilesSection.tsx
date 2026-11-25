import React, { useRef, useState } from 'react';
import { Upload, FileText, Download, Trash2, Image as ImageIcon } from 'lucide-react';
import { ProjectFile } from '../../../../types';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { formatDate, label } from '../../ui/Badges';
import { Button, IconButton, EmptyState, toolbarSelectClass } from '../../ui/Field';

const CATEGORIES: Array<{ value: ProjectFile['category']; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'contracts', label: 'Contracts' },
  { value: 'specs', label: 'Specifications' },
  { value: 'assets', label: 'Assets' },
  { value: 'deliverables', label: 'Deliverables' },
];

const MAX_MB = 25;

export const FilesSection: React.FC = () => {
  const { projectId, files, setFiles, canManage, reload } = useProject();
  const { currentUser, confirm, showToast } = useApp();
  const [category, setCategory] = useState<ProjectFile['category']>('general');
  const [filter, setFilter] = useState<'all' | ProjectFile['category']>('all');
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    for (const file of Array.from(list)) {
      if (file.size > MAX_MB * 1024 * 1024) {
        showToast(`${file.name} is larger than ${MAX_MB} MB`, 'error');
        continue;
      }
      setUploading(file.name);
      try {
        const form = new FormData();
        form.append('category', category);
        form.append('file', file);
        const created = await api.upload<ProjectFile>(`/api/projects/${projectId}/files`, form);
        setFiles((prev) => [created, ...prev]);
      } catch (err: any) {
        showToast(`${file.name}: ${err.message}`, 'error');
      }
    }
    setUploading(null);
    reload('activity').catch(() => {});
    if (inputRef.current) inputRef.current.value = '';
  };

  const download = async (file: ProjectFile) => {
    try {
      await api.download(`/api/projects/${projectId}/files/${file.id}/download`, file.name);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const remove = async (file: ProjectFile) => {
    const ok = await confirm({ title: 'Delete file?', message: `“${file.name}” will be permanently deleted for everyone on the project.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/api/projects/${projectId}/files/${file.id}`);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      reload('activity').catch(() => {});
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const visible = filter === 'all' ? files : files.filter((f) => f.category === filter);

  return (
    <div
      className="space-y-4 max-w-5xl"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        upload(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filter by category" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={toolbarSelectClass}>
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-[13px] text-fg-muted" htmlFor="upload-category">
            Upload as
          </label>
          <select id="upload-category" value={category} onChange={(e) => setCategory(e.target.value as ProjectFile['category'])} className={toolbarSelectClass}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input ref={inputRef} type="file" multiple className="sr-only" id="file-upload" onChange={(e) => upload(e.target.files)} tabIndex={-1} />
          <Button onClick={() => inputRef.current?.click()} disabled={!!uploading}>
            <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </div>

      <div
        className={`rounded-lg border border-dashed px-4 py-3 text-[13px] text-center transition-colors ${
          dragOver ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line-strong text-fg-faint'
        }`}
      >
        {uploading ? `Uploading ${uploading}…` : `Drop files anywhere here to upload · up to ${MAX_MB} MB each`}
      </div>

      {visible.length === 0 ? (
        <EmptyState message={files.length === 0 ? 'No files uploaded yet.' : 'No files in this category.'} />
      ) : (
        <div className="border border-line rounded-lg overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_110px_80px_150px_64px] gap-3 px-3 h-8 items-center bg-subtle border-b border-line text-xs font-medium text-fg-faint">
            <span>Name</span>
            <span>Category</span>
            <span>Size</span>
            <span>Uploaded</span>
            <span aria-hidden="true" />
          </div>
          <ul className="divide-y divide-line">
            {visible.map((file) => {
              const hasContent = !!file.storedName;
              const canDelete = file.uploadedById === currentUser?.id || canManage;
              return (
                <li key={file.id} className="group grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_110px_80px_150px_64px] gap-3 px-3 py-2 items-center hover:bg-subtle">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {file.mimeType?.startsWith('image/') ? <ImageIcon size={16} className="text-fg-faint shrink-0" /> : <FileText size={16} className="text-fg-faint shrink-0" />}
                    <div className="min-w-0">
                      <button
                        onClick={() => hasContent && download(file)}
                        disabled={!hasContent}
                        className="block py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0 text-[15px] pointer-fine:text-sm text-fg truncate max-w-full text-left enabled:hover:underline underline-offset-2 disabled:cursor-default"
                        title={hasContent ? `Download ${file.name}` : 'Sample entry: no stored file'}
                      >
                        {file.name}
                      </button>
                      <div className="md:hidden text-xs text-fg-faint">
                        {file.fileSize} · {file.uploadedBy}
                      </div>
                    </div>
                  </div>
                  <span className="hidden md:block text-[13px] text-fg-muted">{label(file.category)}</span>
                  <span className="hidden md:block text-[13px] text-fg-muted tabular-nums">{file.fileSize}</span>
                  <span className="hidden md:block text-[13px] text-fg-muted truncate">
                    {formatDate(file.uploadedAt)} · {file.uploadedBy.split(' ')[0]}
                    {!hasContent && <span className="text-fg-faint"> · sample</span>}
                  </span>
                  <div className="flex items-center justify-end gap-0.5">
                    <IconButton label={hasContent ? `Download ${file.name}` : 'Sample entry: nothing to download'} disabled={!hasContent} onClick={() => download(file)}>
                      <Download size={14} />
                    </IconButton>
                    {canDelete && (
                      <IconButton label={`Delete ${file.name}`} danger onClick={() => remove(file)} className="md:opacity-0 md:group-hover:opacity-100 focus:opacity-100">
                        <Trash2 size={14} />
                      </IconButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
