import { useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Library, Plus, Trash2, FileText, Upload, ArrowLeft,
  Search, Sparkles, X, FolderOpen, File, Clock,
  Globe, Users, MoreVertical, Edit2, ChevronDown,
  Image, FileCode, FileSpreadsheet, Check,
} from 'lucide-react';
import { librariesApi, type Library as LibraryType } from '../../api/libraries';
import { QK } from '../../lib/queryClient';
import { cn } from '../../lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};


/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function relativeTime(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '—';
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getFileTypeLabel(filename: string, _mimeType?: string): string {
  const ext = filename.split('.').pop()?.toUpperCase() || '';
  const map: Record<string, string> = {
    PDF: 'PDF', DOCX: 'DOCX', DOC: 'DOC', PPTX: 'PPTX', PPT: 'PPT',
    XLSX: 'XLSX', XLS: 'XLS', CSV: 'CSV', TXT: 'TXT', MD: 'MD',
    HTML: 'HTML', JSON: 'JSON', XML: 'XML', PY: 'PY', JS: 'JS',
    JPG: 'JPG', JPEG: 'JPEG', PNG: 'PNG', GIF: 'GIF', WEBP: 'WEBP',
    RTF: 'RTF', EPUB: 'EPUB', SVG: 'SVG',
  };
  return map[ext] || ext || 'FILE';
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
  const codeExts = ['py', 'js', 'ts', 'html', 'css', 'json', 'xml', 'yaml', 'md', 'rst'];
  const sheetExts = ['xlsx', 'xls', 'csv', 'ods', 'numbers'];
  if (imgExts.includes(ext)) return { icon: Image, color: 'text-emerald-400' };
  if (codeExts.includes(ext)) return { icon: FileCode, color: 'text-amber-400' };
  if (sheetExts.includes(ext)) return { icon: FileSpreadsheet, color: 'text-green-400' };
  return { icon: File, color: 'text-indigo-400' };
}

function formatSize(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


/* ═══════════════════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════════════════ */

export default function LibraryManager() {
  const [selectedLibrary, setSelectedLibrary] = useState<LibraryType | null>(null);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <AnimatePresence mode="wait">
        {selectedLibrary ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <LibraryDetail
              library={selectedLibrary}
              onBack={() => setSelectedLibrary(null)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
          >
            <LibraryList onSelect={setSelectedLibrary} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Library List View
   ═══════════════════════════════════════════════════════════════════════════ */

function LibraryList({ onSelect }: { onSelect: (lib: LibraryType) => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  const { data: libraries = [], isLoading } = useQuery({
    queryKey: QK.libraries(),
    queryFn: () => librariesApi.list().then(r => r.data),
  });

  const filtered = libraries.filter(
    (l) => !search || l.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const createMut = useMutation({
    mutationFn: () => librariesApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.libraries() });
      setShowCreate(false);
      setForm({ name: '', description: '' });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => librariesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.libraries() }),
  });

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            Document <span className="text-gradient-vibrant">Libraries</span>
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Organize and include information for your chats.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary shrink-0 flex items-center gap-2 px-4 py-2 text-sm rounded-md self-start sm:self-auto"
        >
          <Plus size={16} /> New Library
        </button>
      </div>

      {/* Create Library Modal */}
      {createPortal(
        <AnimatePresence>
          {showCreate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
              <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-white" />
                  <h2 className="text-sm font-medium text-white">Create New Library</h2>
                </div>
                <button onClick={() => setShowCreate(false)} className="text-[var(--color-text-muted)] hover:text-white transition-colors p-1 rounded-md hover:bg-[var(--color-bg-hover)]">
                  <X size={16} />
                </button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Name</label>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Product Documentation" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Description</label>
                    <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What kind of documents are in this library?" className="w-full minimal-input rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-border-focus)] transition-all" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] mt-auto">
                <button onClick={() => setShowCreate(false)} className="btn-secondary px-4 py-2 text-sm rounded-md hover:bg-[var(--color-bg-hover)] transition-colors">Cancel</button>
                <button onClick={() => createMut.mutate()} disabled={!form.name || createMut.isPending} className="btn-primary px-4 py-2 text-sm rounded-md disabled:opacity-50 transition-all hover:shadow-[0_0_15px_rgba(99,102,241,0.4)]">
                  {createMut.isPending ? 'Creating...' : 'Create Library'}
                </button>
              </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search libraries..." className="w-full minimal-input bg-[var(--color-bg-surface)] rounded-md pl-9 pr-4 py-2.5 text-sm" />
      </div>

      {/* Grid */}
      {isLoading ? (
        <SkeletonGrid />
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((lib) => (
            <LibraryCard key={lib.id} library={lib} onClick={() => onSelect(lib)} onDelete={(id) => deleteMut.mutate(id)} />
          ))}
        </motion.div>
      )}
    </>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Library Card
   ═══════════════════════════════════════════════════════════════════════════ */

function LibraryCard({ library, onClick, onDelete }: { library: LibraryType; onClick: () => void; onDelete: (id: string) => void }) {
  return (
    <motion.div variants={itemVariants} onClick={onClick}
      className={cn(
        'rounded-xl p-5 group flex flex-col h-full cursor-pointer hover:scale-[1.01] transition-all shadow-lg',
        'bg-gradient-to-br from-[rgba(99,102,241,0.06)] to-[rgba(139,92,246,0.04)]',
        'border border-[rgba(99,102,241,0.15)] hover:border-[rgba(99,102,241,0.35)]',
      )}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border bg-[rgba(99,102,241,0.1)] border-[rgba(99,102,241,0.2)]">
          <Library size={18} className="text-indigo-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-[var(--color-text-primary)] break-words">{library.name}</h3>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[rgba(99,102,241,0.1)] text-[10px] text-indigo-400 border border-[rgba(99,102,241,0.2)] font-medium">
              <FileText size={10} />{library.document_count ?? 0} docs
            </span>
          </div>
        </div>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed line-clamp-2 flex-1">
        {library.description || <span className="italic opacity-50">No description provided</span>}
      </p>
      <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)] flex items-center justify-between">
        <p className="text-[10px] text-[var(--color-text-muted)] font-[family-name:var(--font-mono)] uppercase tracking-wider flex items-center gap-1.5">
          <Clock size={10} />
          {library.created_at ? relativeTime(library.created_at) : '\u00A0'}
        </p>
        <button onClick={(e) => { e.stopPropagation(); onDelete(library.id); }}
          className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-accent-danger)] transition-colors opacity-0 group-hover:opacity-100 z-10">
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Library Detail View  (matches Mistral Studio screenshot)
   ═══════════════════════════════════════════════════════════════════════════ */

function LibraryDetail({ library, onBack }: { library: LibraryType; onBack: () => void }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [showWebpageModal, setShowWebpageModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [activeDocMenu, setActiveDocMenu] = useState<string | null>(null);

  // Current library state (for rename)
  const [libName, setLibName] = useState(library.name);
  const [libDesc, setLibDesc] = useState(library.description || '');

  const { data: documents = [], isLoading } = useQuery({
    queryKey: QK.libraryDocs(library.id),
    queryFn: () => librariesApi.listDocuments(library.id).then(r => r.data),
  });

  // Filtered + sorted documents
  const processedDocs = useMemo(() => {
    let docs = [...documents];
    if (filter) {
      const q = filter.toLowerCase();
      docs = docs.filter(d => d.filename?.toLowerCase().includes(q));
    }
    docs.sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      if (sortBy === 'oldest') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      return (a.filename || '').localeCompare(b.filename || '');
    });
    return docs;
  }, [documents, filter, sortBy]);

  const uploadMut = useMutation({
    mutationFn: (file: File) => librariesApi.uploadDocument(library.id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.libraryDocs(library.id) });
      qc.invalidateQueries({ queryKey: QK.libraries() });
      setUploadProgress(null);
    },
    onError: () => setUploadProgress(null),
  });

  const deleteMut = useMutation({
    mutationFn: (docId: string) => librariesApi.deleteDocument(library.id, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.libraryDocs(library.id) });
      qc.invalidateQueries({ queryKey: QK.libraries() });
    },
  });

  const bulkDeleteMut = useMutation({
    mutationFn: async () => {
      for (const docId of selectedDocs) {
        await librariesApi.deleteDocument(library.id, docId);
      }
    },
    onSuccess: () => {
      setSelectedDocs(new Set());
      qc.invalidateQueries({ queryKey: QK.libraryDocs(library.id) });
      qc.invalidateQueries({ queryKey: QK.libraries() });
    },
  });

  const renameMut = useMutation({
    mutationFn: () => librariesApi.update(library.id, { name: libName, description: libDesc }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.libraries() });
      setShowRenameModal(false);
    },
  });

  const deleteLibMut = useMutation({
    mutationFn: () => librariesApi.delete(library.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.libraries() });
      onBack();
    },
  });

  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  const MAX_FILE_COUNT = 100;

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const fileArr = Array.from(files);
      if (fileArr.length > MAX_FILE_COUNT) {
        alert(`You can upload up to ${MAX_FILE_COUNT} files at once.`);
        return;
      }
      for (const file of fileArr) {
        if (file.size > MAX_FILE_SIZE) {
          alert(`"${file.name}" exceeds the 100 MB limit and was skipped.`);
          continue;
        }
        setUploadProgress(`Uploading ${file.name}...`);
        uploadMut.mutate(file);
      }
    },
    [uploadMut],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const allSelected = processedDocs.length > 0 && selectedDocs.size === processedDocs.length;
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(processedDocs.map(d => d.id)));
    }
  };
  const toggleDoc = (id: string) => {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <>
      {/* Header Row */}
      <div className="flex items-start gap-4 mb-6">
        <button onClick={onBack} className="mt-1 p-2 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center border bg-[rgba(99,102,241,0.1)] border-[rgba(99,102,241,0.2)]">
              <Library size={18} className="text-indigo-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-white truncate">{libName}</h1>
              {libDesc && <p className="text-sm text-[var(--color-text-muted)] truncate">{libDesc}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons (Upload / Webpage / Share / ⋮) */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button onClick={() => fileInputRef.current?.click()}
          className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm rounded-md">
          <Plus size={14} /> Upload
        </button>
        <button onClick={() => setShowWebpageModal(true)}
          className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm rounded-md">
          <Globe size={14} /> Webpage
        </button>
        <button onClick={() => setShowShareModal(true)}
          className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm rounded-md">
          <Users size={14} /> Share
        </button>

        {/* Library ⋮ Menu */}
        <div className="relative">
          <button onClick={() => setShowLibraryMenu(!showLibraryMenu)}
            className="btn-secondary p-2 rounded-md">
            <MoreVertical size={16} />
          </button>
          <AnimatePresence>
            {showLibraryMenu && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="absolute right-0 mt-1 z-30 w-44 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg shadow-xl overflow-hidden">
                <button onClick={() => { setShowLibraryMenu(false); setShowRenameModal(true); }}
                  className="w-full px-4 py-2.5 text-sm text-left text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] flex items-center gap-2 transition-colors">
                  <Edit2 size={14} /> Rename
                </button>
                <button onClick={() => { setShowLibraryMenu(false); deleteLibMut.mutate(); }}
                  className="w-full px-4 py-2.5 text-sm text-left text-[var(--color-accent-danger)] hover:bg-[rgba(239,68,68,0.08)] flex items-center gap-2 transition-colors">
                  <Trash2 size={14} /> Delete Library
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bulk Delete */}
        <AnimatePresence>
          {selectedDocs.size > 0 && (
            <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending}
              className="ml-auto flex items-center gap-2 px-3 py-2 text-xs rounded-md bg-[rgba(239,68,68,0.1)] text-[var(--color-accent-danger)] border border-[rgba(239,68,68,0.2)] hover:bg-[rgba(239,68,68,0.15)] transition-colors">
              <Trash2 size={12} /> Delete {selectedDocs.size} selected
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" multiple
        accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.csv,.txt,.md,.markdown,.rtf,.epub,.odt,.ods,.numbers,.png,.jpeg,.jpg,.webp,.gif,.html,.css,.js,.py,.php,.json,.xml,.yaml,.latex,.rst"
        onChange={(e) => handleFiles(e.target.files)} className="hidden" />

      {/* Upload progress */}
      <AnimatePresence>
        {uploadProgress && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-4 px-4 py-3 rounded-lg bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.2)] flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-indigo-400 font-medium">{uploadProgress}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drop zone overlay (appears when dragging) */}
      <div ref={dropRef}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <AnimatePresence>
          {isDragging && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="mb-4 rounded-xl border-2 border-dashed border-indigo-400 bg-[rgba(99,102,241,0.08)] p-8 flex flex-col items-center justify-center gap-3 shadow-[0_0_30px_rgba(99,102,241,0.15)]">
              <div className="w-14 h-14 rounded-full bg-[rgba(99,102,241,0.15)] border border-[rgba(99,102,241,0.3)] flex items-center justify-center">
                <Upload size={24} className="text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-indigo-400">Drop files to upload</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter + Sort bar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter"
              className="w-full minimal-input bg-[var(--color-bg-surface)] rounded-md pl-9 pr-4 py-2 text-sm" />
          </div>

          {/* Sort Dropdown */}
          <div className="relative">
            <button onClick={() => setShowSortMenu(!showSortMenu)}
              className="btn-secondary flex items-center gap-1.5 px-3 py-2 text-sm rounded-md whitespace-nowrap">
              {sortBy === 'newest' ? 'Newest' : sortBy === 'oldest' ? 'Oldest' : 'Name'}
              <ChevronDown size={14} className={cn('transition-transform', showSortMenu && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {showSortMenu && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 mt-1 z-20 w-36 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg shadow-xl overflow-hidden">
                  {(['newest', 'oldest', 'name'] as const).map(opt => (
                    <button key={opt} onClick={() => { setSortBy(opt); setShowSortMenu(false); }}
                      className={cn(
                        'w-full px-3 py-2 text-sm text-left capitalize flex items-center justify-between transition-colors',
                        sortBy === opt ? 'text-white bg-[var(--color-bg-hover)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
                      )}>
                      {opt}
                      {sortBy === opt && <Check size={14} className="text-indigo-400" />}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Documents Table */}
        {isLoading ? (
          <DocumentSkeleton />
        ) : processedDocs.length === 0 ? (
          documents.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer text-center py-16 px-6 rounded-2xl flex flex-col items-center justify-center gap-4 bg-[rgba(15,20,28,0.4)] backdrop-blur-xl border border-dashed border-[rgba(255,255,255,0.1)] hover:border-[rgba(99,102,241,0.3)] shadow-[inset_0_0_30px_rgba(0,0,0,0.2)] transition-colors">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-[rgba(99,102,241,0.2)] flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.15)]">
                <FolderOpen size={28} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-[var(--color-text-primary)]">Drag and Drop files here</p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm mx-auto">
                  or click to browse. Up to 100 files, 100 MB per file.
                </p>
              </div>
            </motion.div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-8 italic">No documents match "{filter}"</p>
          )
        ) : (
          <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-0">
            {/* Table Header */}
            <div className="grid grid-cols-[40px_1fr_140px_40px] gap-4 px-5 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
              <div className="flex items-center justify-center">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 rounded border-[var(--color-border-subtle)] accent-indigo-500 cursor-pointer" />
              </div>
              <span>File</span>
              <span>Upload date</span>
              <span></span>
            </div>

            {processedDocs.map((doc) => {
              const { icon: FileIcon, color } = getFileIcon(doc.filename);
              const typeLabel = getFileTypeLabel(doc.filename, doc.mime_type);
              const sizeStr = formatSize(doc.size);

              return (
                <motion.div key={doc.id} variants={itemVariants}
                  className={cn(
                    'grid grid-cols-[40px_1fr_140px_40px] gap-4 items-center px-5 py-3 group transition-all border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]',
                    selectedDocs.has(doc.id) && 'bg-[rgba(99,102,241,0.04)]',
                  )}>
                  <div className="flex items-center justify-center">
                    <input type="checkbox" checked={selectedDocs.has(doc.id)} onChange={() => toggleDoc(doc.id)}
                      className="w-3.5 h-3.5 rounded border-[var(--color-border-subtle)] accent-indigo-500 cursor-pointer" />
                  </div>

                  {/* File info: icon + name + type badge + size */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn('w-8 h-8 rounded-md bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center shrink-0')}>
                      <FileIcon size={14} className={color} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-[var(--color-text-primary)] font-medium block truncate">
                        {doc.filename}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        {typeLabel}{sizeStr ? ` \u00B7 ${sizeStr}` : ''}
                      </span>
                    </div>
                  </div>

                  {/* Upload date */}
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {relativeTime(doc.created_at)}
                  </span>

                  {/* Per-document ⋮ menu */}
                  <div className="relative">
                    <button onClick={() => setActiveDocMenu(activeDocMenu === doc.id ? null : doc.id)}
                      className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-white hover:bg-[var(--color-bg-hover)] transition-colors opacity-0 group-hover:opacity-100">
                      <MoreVertical size={14} />
                    </button>
                    <AnimatePresence>
                      {activeDocMenu === doc.id && (
                        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                          className="absolute right-0 mt-1 z-30 w-36 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg shadow-xl overflow-hidden">
                          <button onClick={() => { deleteMut.mutate(doc.id); setActiveDocMenu(null); }}
                            className="w-full px-3 py-2 text-sm text-left text-[var(--color-accent-danger)] hover:bg-[rgba(239,68,68,0.08)] flex items-center gap-2 transition-colors">
                            <Trash2 size={12} /> Delete
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}

            {/* Document count */}
            <div className="px-5 py-3 text-xs text-[var(--color-text-muted)]">
              Showing {processedDocs.length} of {documents.length} {documents.length === 1 ? 'file' : 'files'}
            </div>
          </motion.div>
        )}
      </div>

      {/* ── Webpage Modal ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {showWebpageModal && (
          <WebpageModal libraryId={library.id} onClose={() => setShowWebpageModal(false)} />
        )}
      </AnimatePresence>

      {/* ── Share Modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showShareModal && (
          <ShareModal libraryId={library.id} libraryName={libName} onClose={() => setShowShareModal(false)} />
        )}
      </AnimatePresence>

      {/* ── Rename Modal ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {showRenameModal && (
          <RenameModal
            name={libName} description={libDesc}
            onNameChange={setLibName} onDescChange={setLibDesc}
            onSave={() => renameMut.mutate()} isPending={renameMut.isPending}
            onClose={() => setShowRenameModal(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Modals
   ═══════════════════════════════════════════════════════════════════════════ */

function WebpageModal({ libraryId, onClose }: { libraryId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');

  const mut = useMutation({
    mutationFn: () => librariesApi.uploadWebpage(libraryId, url),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.libraryDocs(libraryId) });
      qc.invalidateQueries({ queryKey: QK.libraries() });
      onClose();
    },
  });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] flex items-center justify-center">
              <Globe size={14} className="text-indigo-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Add Webpage</h3>
              <p className="text-[10px] text-[var(--color-text-muted)]">Fetch and import a webpage as a document</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white p-1"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/docs"
              className="w-full minimal-input rounded-md px-3 py-2 text-sm" autoFocus />
          </div>
          {mut.isError && (
            <p className="text-xs text-[var(--color-accent-danger)]">Failed to fetch webpage. Check the URL and try again.</p>
          )}
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-[var(--color-border-subtle)]">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm rounded-md">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={!url.trim() || mut.isPending}
            className="btn-primary px-4 py-2 text-sm rounded-md disabled:opacity-50 flex items-center gap-2">
            <Globe size={14} /> {mut.isPending ? 'Fetching...' : 'Import Webpage'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function ShareModal({ libraryId, libraryName, onClose }: { libraryId: string; libraryName: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/libraries?id=${libraryId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] flex items-center justify-center">
              <Users size={14} className="text-indigo-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Share Library</h3>
              <p className="text-[10px] text-[var(--color-text-muted)]">Share "{libraryName}" with your team</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white p-1"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Library Link</label>
            <div className="flex items-center gap-2">
              <input value={shareUrl} readOnly className="flex-1 minimal-input rounded-md px-3 py-2 text-sm text-[var(--color-text-muted)]" />
              <button onClick={copyLink}
                className={cn("btn-primary px-4 py-2 text-sm rounded-md whitespace-nowrap flex items-center gap-2", copied && "bg-emerald-600")}>
                {copied ? <><Check size={14} /> Copied!</> : 'Copy Link'}
              </button>
            </div>
          </div>
          <div className="bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)] rounded-lg p-4">
            <p className="text-xs text-[var(--color-text-muted)]">
              <span className="text-indigo-400 font-medium">Note:</span> Sharing via the Mistral API requires the library owner
              to configure access through the <code className="text-[10px] bg-[var(--color-bg-hover)] px-1 py-0.5 rounded">PUT /v1/libraries/{'{'}library_id{'}'}/share</code> endpoint.
            </p>
          </div>
        </div>
        <div className="flex justify-end p-5 border-t border-[var(--color-border-subtle)]">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm rounded-md">Close</button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function RenameModal({ name, description, onNameChange, onDescChange, onSave, isPending, onClose }: {
  name: string; description: string; onNameChange: (v: string) => void; onDescChange: (v: string) => void;
  onSave: () => void; isPending: boolean; onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] flex items-center justify-center">
              <Edit2 size={14} className="text-indigo-400" />
            </div>
            <h3 className="font-semibold text-white">Rename Library</h3>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-white p-1"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Name</label>
            <input value={name} onChange={(e) => onNameChange(e.target.value)} className="w-full minimal-input rounded-md px-3 py-2 text-sm" autoFocus />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider font-medium">Description</label>
            <input value={description} onChange={(e) => onDescChange(e.target.value)} className="w-full minimal-input rounded-md px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-[var(--color-border-subtle)]">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm rounded-md">Cancel</button>
          <button onClick={onSave} disabled={!name.trim() || isPending}
            className="btn-primary px-4 py-2 text-sm rounded-md disabled:opacity-50">
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Shared Components
   ═══════════════════════════════════════════════════════════════════════════ */

function EmptyState() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden text-center py-24 px-6 rounded-2xl flex flex-col items-center justify-center min-h-[50vh] gap-4 bg-[var(--color-bg-surface)] backdrop-blur-xl border border-[var(--color-border-subtle)] shadow-xl w-full mt-2 group"
    >
      {/* Background Glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--color-bg-base)] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-indigo-500/10 rounded-full blur-[80px] pointer-events-none group-hover:bg-indigo-500/20 transition-all duration-700" />
      
      <div className="relative z-10 w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-[rgba(99,102,241,0.2)] flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(99,102,241,0.15)] group-hover:scale-110 transition-transform duration-500">
        <Library size={32} className="text-indigo-400" />
      </div>
      <div className="relative z-10">
        <p className="text-xl font-semibold text-[var(--color-text-primary)]">No libraries found</p>
        <p className="text-sm text-[var(--color-text-muted)] mt-2 max-w-sm mx-auto">Create a document library to enable RAG for your agents.</p>
      </div>
    </motion.div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="surface-card rounded-xl p-5 flex flex-col h-full gap-4 animate-pulse">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-hover)] shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 w-3/4 rounded bg-[var(--color-bg-hover)]" />
              <div className="h-3 w-1/3 rounded bg-[var(--color-bg-hover)]" />
            </div>
          </div>
          <div className="space-y-2 mt-2">
            <div className="h-3 w-full rounded bg-[var(--color-bg-hover)]" />
            <div className="h-3 w-4/5 rounded bg-[var(--color-bg-hover)]" />
          </div>
          <div className="mt-auto pt-4 border-t border-[var(--color-border-subtle)]">
            <div className="h-3 w-1/2 rounded bg-[var(--color-bg-hover)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DocumentSkeleton() {
  return (
    <div className="space-y-0">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-[var(--color-border-subtle)] animate-pulse">
          <div className="w-4 h-4 rounded bg-[var(--color-bg-hover)]" />
          <div className="w-8 h-8 rounded-md bg-[var(--color-bg-hover)] shrink-0" />
          <div className="flex-1 space-y-1">
            <div className="h-4 w-1/2 rounded bg-[var(--color-bg-hover)]" />
            <div className="h-3 w-1/4 rounded bg-[var(--color-bg-hover)]" />
          </div>
          <div className="w-24 h-3 rounded bg-[var(--color-bg-hover)]" />
        </div>
      ))}
    </div>
  );
}
