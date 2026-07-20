'use client';

import { useCallback, useEffect, useMemo, useState, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import {
  Sparkles,
  Search,
  Paperclip,
  Upload,
  Sun,
  Moon,
  Monitor,
  Clock,
  Lock,
  LogOut,
  Settings,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/hooks/use-theme';
import { useSettingsStore } from '@/lib/store/settings';
import { hasUsableLLMProvider } from '@/lib/store/settings-validation';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { deleteStageData } from '@/lib/utils/stage-storage';
import { hydrateSolverClassroom } from '@/lib/solver/sync';
import { useSolverAuth } from '@/lib/hooks/use-solver-auth';
import { SettingsDialog } from '@/components/settings';
import type { SolverActivity, UserRequirements } from '@/lib/types/generation';
import { SOLVER_ACTIVITY_VALUES } from '@/lib/types/generation';

const MAX_QUESTION_LENGTH = 2000;
const HISTORY_PREVIEW_COUNT = 6;

const ACTIVITY_STORAGE_KEY = 'solverActivities';

const ACTIVITY_OPTIONS: Array<{ id: SolverActivity; label: string }> = [
  { id: 'quiz', label: 'Quiz' },
  { id: 'pbl', label: 'Project' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'diagram', label: 'Diagram' },
  { id: 'code', label: 'Code' },
  { id: 'game', label: 'Game' },
  { id: 'visualization3d', label: '3D' },
];

function loadStoredActivities(): SolverActivity[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return ['quiz'];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ['quiz'];
    return SOLVER_ACTIVITY_VALUES.filter((a) => parsed.includes(a));
  } catch {
    return ['quiz'];
  }
}

interface SolverHistoryItem {
  id: string;
  name: string;
  updatedAt: number;
}

function groupLabelForTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupHistory(
  items: SolverHistoryItem[],
): Array<{ label: string; items: SolverHistoryItem[] }> {
  const groups: Array<{ label: string; items: SolverHistoryItem[] }> = [];
  for (const item of items) {
    const label = groupLabelForTimestamp(item.updatedAt);
    const existing = groups.find((g) => g.label === label);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  value: string,
  snippet: string,
  setValue: (next: string) => void,
) {
  if (!textarea) {
    setValue(value + snippet);
    return;
  }
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const next = value.slice(0, start) + snippet + value.slice(end);
  setValue(next.slice(0, MAX_QUESTION_LENGTH));
  requestAnimationFrame(() => {
    textarea.focus();
    const caret = start + snippet.length;
    textarea.setSelectionRange(caret, caret);
  });
}

export default function SolverPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [themeOpen, setThemeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [activities, setActivities] = useState<SolverActivity[]>(['quiz']);
  const [history, setHistory] = useState<SolverHistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const { user, loading: authLoading, login, register, logout } = useSolverAuth();
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const hasUsableProvider = hasUsableLLMProvider(providersConfig);
  const avatarInitial = ((user?.name || user?.email || 'A').trim().charAt(0) || 'A').toUpperCase();

  const loadHistory = useCallback(async () => {
    if (!user) {
      setHistory([]);
      return;
    }
    try {
      const res = await fetch('/api/solver/classrooms');
      if (!res.ok) {
        setHistory([]);
        return;
      }
      const body = (await res.json()) as {
        classrooms?: Array<{ id: string; title: string; updatedAt: number }>;
      };
      setHistory(
        (body.classrooms ?? []).map((c) => ({ id: c.id, name: c.title, updatedAt: c.updatedAt })),
      );
    } catch {
      setHistory([]);
    }
  }, [user]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setActivities(loadStoredActivities());
  }, []);

  const toggleActivity = (id: SolverActivity) => {
    setActivities((prev) => {
      const next = prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id];
      try {
        localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage unavailable (private mode) — selection just won't persist
      }
      return next;
    });
  };

  useEffect(() => {
    if (!themeOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [themeOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [accountOpen]);

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (authSubmitting) return;
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      const error =
        authMode === 'signin'
          ? await login(authEmail, authPassword)
          : await register(authEmail, authPassword, authName || undefined);
      if (error) {
        setAuthError(error);
      } else {
        setAuthPassword('');
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const openHistoryItem = async (id: string) => {
    if (openingId) return;
    setOpeningId(id);
    try {
      // Hydrate from the server snapshot when this device doesn't have the
      // classroom locally (cross-device open); local copies always win.
      await hydrateSolverClassroom(id);
      router.push(`/classroom/${id}`);
    } finally {
      setOpeningId(null);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      const res = await fetch(`/api/solver/classrooms/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 404) {
        toast.error('Could not delete this solve. Please try again.');
        return;
      }
      await deleteStageData(id).catch(() => {});
      setHistory((prev) => prev.filter((h) => h.id !== id));
    } catch {
      toast.error('Could not delete this solve. Please try again.');
    }
  };

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => h.name?.toLowerCase().includes(q));
  }, [history, searchQuery]);

  const visibleHistory = showAllHistory
    ? filteredHistory
    : filteredHistory.slice(0, HISTORY_PREVIEW_COUNT);
  const historyGroups = useMemo(() => groupHistory(visibleHistory), [visibleHistory]);

  const showComingSoonToast = () => {
    toast.info('Image solving is coming soon — type your question for now.');
  };

  const handleSolve = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;

    if (!hasUsableProvider) {
      setSettingsOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: trimmed,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        solverMode: true,
        solverActivities: activities,
      };

      const sessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        documentSources: undefined,
        pdfStorageKey: undefined,
        pdfFileName: undefined,
        documentMimeType: undefined,
        pdfProviderId: undefined,
        pdfProviderConfig: undefined,
        sceneOutlines: null,
        currentStep: 'generating' as const,
      };
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));

      router.push('/generation-preview');
    } catch {
      setSubmitting(false);
      toast.error('Something went wrong preparing your question. Please try again.');
    }
  };

  const canSolve = question.trim().length > 0 && !submitting;

  return (
    <div className="min-h-[100dvh] w-full flex bg-[#FBF7F1] dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* ═══ Sidebar ═══ */}
      <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-orange-900/10 dark:border-white/10 bg-[#FBF7F1] dark:bg-slate-950 p-4">
        <div className="flex items-center gap-2 mb-6">
          <div className="flex size-8 items-center justify-center rounded-full bg-orange-500 text-white">
            <Sparkles className="size-4" />
          </div>
          <span className="font-semibold text-sm">Math Solver</span>
        </div>

        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your history..."
            className="w-full rounded-lg border border-orange-900/10 dark:border-white/10 bg-white/70 dark:bg-slate-900/60 pl-9 pr-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-orange-400/50"
          />
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {historyGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 px-1">
              {!user
                ? 'Sign in to see your history.'
                : history.length === 0
                  ? 'Solved questions will show up here.'
                  : 'No matches found.'}
            </p>
          ) : (
            historyGroups.map((group) => (
              <div key={group.label} className="mb-4">
                <p className="text-[11px] font-medium text-muted-foreground/50 px-1 mb-1.5">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center rounded-lg hover:bg-orange-500/10 transition-colors group"
                    >
                      <button
                        onClick={() => void openHistoryItem(item.id)}
                        disabled={openingId !== null}
                        className="flex-1 min-w-0 text-left px-2.5 py-2"
                      >
                        <p className="text-xs font-medium truncate group-hover:text-orange-600 dark:group-hover:text-orange-400">
                          {openingId === item.id ? 'Opening…' : item.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground/50 truncate">
                          {new Date(item.updatedAt).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                      </button>
                      <button
                        onClick={() => void deleteHistoryItem(item.id)}
                        title="Delete this solve"
                        className="opacity-0 group-hover:opacity-100 shrink-0 p-2 mr-1 rounded-md text-muted-foreground/50 hover:text-red-500 transition-all"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {!showAllHistory && filteredHistory.length > HISTORY_PREVIEW_COUNT && (
          <button
            onClick={() => setShowAllHistory(true)}
            className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground/80 transition-colors px-1"
          >
            <Clock className="size-3.5" />
            View all history
          </button>
        )}
      </aside>

      {/* ═══ Main area ═══ */}
      <main className="relative flex-1 flex flex-col items-center justify-center p-4 md:p-8">
        {/* Top-right controls */}
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          <div className="relative" ref={themeMenuRef}>
            <button
              onClick={() => setThemeOpen(!themeOpen)}
              className="flex size-9 items-center justify-center rounded-full bg-white/70 dark:bg-slate-800/70 border border-orange-900/10 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              {theme === 'light' && <Sun className="size-4" />}
              {theme === 'dark' && <Moon className="size-4" />}
              {theme === 'system' && <Monitor className="size-4" />}
            </button>
            {themeOpen && (
              <div className="absolute top-full mt-2 right-0 bg-white dark:bg-slate-800 border border-border rounded-lg shadow-lg overflow-hidden z-50 min-w-[120px]">
                {(['light', 'dark', 'system'] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setTheme(opt);
                      setThemeOpen(false);
                    }}
                    className={cn(
                      'w-full px-3 py-2 text-left text-xs hover:bg-muted transition-colors capitalize',
                      theme === opt && 'text-orange-600 dark:text-orange-400',
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
          {user ? (
            <div className="relative" ref={accountMenuRef}>
              <button
                onClick={() => setAccountOpen(!accountOpen)}
                className="flex size-9 items-center justify-center rounded-full bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 transition-colors"
                title="Account & settings"
              >
                {avatarInitial}
              </button>
              {accountOpen && (
                <div className="absolute top-full mt-2 right-0 bg-white dark:bg-slate-800 border border-border rounded-lg shadow-lg overflow-hidden z-50 min-w-[200px]">
                  <div className="px-3 py-2 border-b border-border">
                    {user.name && <p className="text-xs font-medium truncate">{user.name}</p>}
                    <p className="text-[11px] text-muted-foreground/60 truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      setAccountOpen(false);
                      setSettingsOpen(true);
                    }}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <Settings className="size-3.5" />
                    Settings
                  </button>
                  <button
                    onClick={() => {
                      setAccountOpen(false);
                      void logout();
                    }}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-muted transition-colors flex items-center gap-2 text-red-500"
                  >
                    <LogOut className="size-3.5" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex size-9 items-center justify-center rounded-full bg-white/70 dark:bg-slate-800/70 border border-orange-900/10 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              title="Settings"
            >
              <Settings className="size-4" />
            </button>
          )}
        </div>

        <div className="w-full max-w-2xl">
          {authLoading ? (
            <div className="rounded-2xl border border-orange-900/10 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl shadow-xl shadow-black/[0.03] p-8 md:p-10 flex items-center justify-center min-h-[280px]">
              <p className="text-sm text-muted-foreground/50">Loading…</p>
            </div>
          ) : !user ? (
            <div className="rounded-2xl border border-orange-900/10 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl shadow-xl shadow-black/[0.03] p-8 md:p-10">
              <div className="flex flex-col items-center text-center mb-6">
                <Sparkles className="size-7 text-orange-500 mb-3" />
                <h1 className="font-serif text-3xl md:text-4xl mb-2">
                  {authMode === 'signin' ? 'Welcome back' : 'Create your account'}
                </h1>
                <p className="text-sm text-muted-foreground/70">
                  {authMode === 'signin'
                    ? 'Sign in to solve questions and see your history.'
                    : 'Register to save every solve to your own classroom history.'}
                </p>
              </div>

              <form onSubmit={handleAuthSubmit} className="space-y-3">
                {authMode === 'signup' && (
                  <input
                    type="text"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    placeholder="Name (optional)"
                    autoComplete="name"
                    className="w-full rounded-xl border border-border/60 bg-white/60 dark:bg-slate-950/40 px-4 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-orange-400/50"
                  />
                )}
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                  className="w-full rounded-xl border border-border/60 bg-white/60 dark:bg-slate-950/40 px-4 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-orange-400/50"
                />
                <input
                  type="password"
                  required
                  minLength={authMode === 'signup' ? 8 : 1}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder={
                    authMode === 'signup' ? 'Password (at least 8 characters)' : 'Password'
                  }
                  autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                  className="w-full rounded-xl border border-border/60 bg-white/60 dark:bg-slate-950/40 px-4 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-orange-400/50"
                />
                {authError && <p className="text-xs text-red-500">{authError}</p>}
                <button
                  type="submit"
                  disabled={authSubmitting}
                  className={cn(
                    'w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all',
                    authSubmitting
                      ? 'bg-muted text-muted-foreground/40 cursor-not-allowed'
                      : 'bg-orange-500 text-white hover:bg-orange-600 shadow-sm cursor-pointer',
                  )}
                >
                  {authSubmitting
                    ? 'Please wait…'
                    : authMode === 'signin'
                      ? 'Sign in'
                      : 'Create account'}
                </button>
              </form>

              <p className="mt-4 text-center text-xs text-muted-foreground/60">
                {authMode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
                    setAuthError(null);
                  }}
                  className="text-orange-600 dark:text-orange-400 hover:underline font-medium"
                >
                  {authMode === 'signin' ? 'Register' : 'Sign in'}
                </button>
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-orange-900/10 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl shadow-xl shadow-black/[0.03] p-8 md:p-10">
              <div className="flex flex-col items-center text-center mb-6">
                <Sparkles className="size-7 text-orange-500 mb-3" />
                <h1 className="font-serif text-3xl md:text-4xl mb-2">Tell me your next question</h1>
                <p className="text-sm text-muted-foreground/70">
                  Ask anything math. Type, paste, or upload an image.
                </p>
              </div>

              <div className="rounded-xl border border-border/60 bg-white/60 dark:bg-slate-950/40">
                <textarea
                  ref={textareaRef}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION_LENGTH))}
                  placeholder="Type your math question here..."
                  rows={4}
                  className="w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm placeholder:text-muted-foreground/40 focus:outline-none min-h-[110px]"
                />
                <div className="flex items-center justify-between px-3 pb-2.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        insertAtCursor(textareaRef.current, question, 'f(x)', setQuestion)
                      }
                      className="flex items-center justify-center h-7 min-w-7 px-1.5 rounded-md text-xs font-mono text-muted-foreground/60 hover:bg-muted hover:text-foreground/80 transition-colors"
                      title="Insert function notation"
                    >
                      f(x)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        insertAtCursor(textareaRef.current, question, 'Σ', setQuestion)
                      }
                      className="flex items-center justify-center h-7 min-w-7 px-1.5 rounded-md text-sm text-muted-foreground/60 hover:bg-muted hover:text-foreground/80 transition-colors"
                      title="Insert summation symbol"
                    >
                      Σ
                    </button>
                    <button
                      type="button"
                      onClick={showComingSoonToast}
                      className="flex items-center justify-center size-7 rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground/80 transition-colors"
                      title="Attach an image (coming soon)"
                    >
                      <Paperclip className="size-3.5" />
                    </button>
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground/40">
                    {question.length}/{MAX_QUESTION_LENGTH}
                  </span>
                </div>
              </div>

              {/* ═══ Activity toggles ═══ */}
              <div className="mt-4">
                <p className="text-[11px] font-medium text-muted-foreground/60 mb-2">
                  Activities in your classroom
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled
                    aria-pressed
                    title="Slides are always included"
                    className="flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500 px-3 py-1.5 text-xs font-medium text-white cursor-default"
                  >
                    <Lock className="size-3" />
                    Slide
                  </button>
                  {ACTIVITY_OPTIONS.map((opt) => {
                    const selected = activities.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleActivity(opt.id)}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          selected
                            ? 'border-orange-500/40 bg-orange-500 text-white hover:bg-orange-600'
                            : 'border-orange-900/10 dark:border-white/10 bg-white/60 dark:bg-slate-900/50 text-muted-foreground/70 hover:bg-orange-500/10 hover:text-foreground/80',
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={showComingSoonToast}
                className="mt-4 w-full rounded-xl border-2 border-dashed border-orange-900/15 dark:border-white/15 bg-orange-500/[0.03] hover:bg-orange-500/[0.06] transition-colors py-6 flex flex-col items-center gap-2"
              >
                <div className="flex size-9 items-center justify-center rounded-full bg-orange-500/10 text-orange-500">
                  <Upload className="size-4" />
                </div>
                <p className="text-sm font-medium">Drop an image or click to upload</p>
                <p className="text-xs text-muted-foreground/50">
                  Supports JPG, PNG, WebP (Max 10MB)
                </p>
              </button>

              <button
                onClick={handleSolve}
                disabled={!canSolve}
                className={cn(
                  'mt-5 w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all',
                  canSolve
                    ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-sm cursor-pointer'
                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                <Sparkles className="size-4" />
                {submitting ? 'Preparing…' : 'Solve with AI'}
              </button>
            </div>
          )}
        </div>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
