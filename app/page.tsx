'use client';

/**
 * Full API Console — a single-file Next.js dashboard covering every endpoint
 * of the enterprise-ecommerce FastAPI backend: auth, categories, products
 * (incl. image upload), cart, orders, payments, reviews, admin users, and a
 * live WebSocket connection (chat + real-time order updates).
 *
 * Drop this in as: app/page.tsx  (Next.js App Router)
 * Requires: Tailwind CSS already configured in the project.
 *
 * Environment variable (add to .env.local, and to your Vercel project settings
 * when deploying — point it at your *publicly reachable* backend, not localhost):
 *
 *   NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
 *
 * NOTE on OrderStatus: pending | processing | shipped | delivered | cancelled
 * — matches app/models/order.py OrderStatus enum.
 *
 * ARCHITECTURE NOTE: the WebSocket connection lives at the top level
 * (ApiConsolePage), not inside the Live tab. It auto-connects once the user
 * is logged in and stays open regardless of which tab is active. This is
 * what makes order-status updates appear on the Orders tab in real time
 * without needing to visit the Live tab or refresh the page.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const REFRESH_TOKEN_KEY = 'ecommerce_refresh_token';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserProfile {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_verified: boolean;
  is_superuser: boolean;
  created_at: string;
}

interface Category {
  id: number;
  name: string;
  description: string | null;
  slug: string;
  is_active: boolean;
  created_at: string;
}

interface ProductImage {
  id: number;
  image_url: string;
  is_primary: boolean;
}

interface Product {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  stock: number;
  category_id: number;
  is_active: boolean;
  created_at: string;
  images: ProductImage[];
}

interface CartItem {
  id: number;
  user_id: number;
  product_id: number;
  quantity: number;
  created_at: string;
  product?: Product | null;
}

interface CartSummary {
  items: CartItem[];
  total_items: number;
  total_price: number;
}

interface OrderItemLine {
  id: number;
  product_id: number;
  quantity: number;
  price: number;
}

interface Order {
  id: number;
  user_id: number;
  total_price: number;
  status: string;
  shipping_address: string;
  created_at: string;
  items: OrderItemLine[];
}

interface Payment {
  id: number;
  order_id: number;
  transaction_id: string | null;
  amount: string;
  status: string;
  provider: string;
  created_at: string;
}

interface Review {
  id: number;
  product_id: number;
  user_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
  user: { id: number; full_name: string };
}

type Health = 'checking' | 'online' | 'offline';
type Tab =
  | 'overview'
  | 'auth'
  | 'categories'
  | 'products'
  | 'cart'
  | 'orders'
  | 'payments'
  | 'reviews'
  | 'users'
  | 'live';

interface AuthState {
  accessToken: string | null;
  user: UserProfile | null;
}

interface IncomingChat {
  from: string;
  message: string;
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  const isFormData = options.body instanceof FormData;
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 204) return undefined as unknown as T;

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // no body
  }

  if (!res.ok) {
    const detail = body?.detail;
    const message = Array.isArray(detail)
      ? detail.map((d: any) => `${(d.loc || []).join('.')}: ${d.msg}`).join(', ')
      : detail || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function StatusDot({ health }: { health: Health }) {
  const color =
    health === 'online' ? 'bg-teal-500' : health === 'offline' ? 'bg-rose-500' : 'bg-amber-400';
  const label = health === 'online' ? 'API online' : health === 'offline' ? 'API offline' : 'checking…';
  return (
    <div className="flex items-center gap-2 font-mono text-xs tracking-wide text-slate-400">
      <span className={`h-2 w-2 rounded-full ${color} ${health === 'checking' ? 'animate-pulse' : ''}`} />
      {label}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>{children}</div>
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-2">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">{children}</h2>
      {action}
    </div>
  );
}

function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <input
        {...props}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      />
    </label>
  );
}

function TextArea({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <textarea
        {...props}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      />
    </label>
  );
}

function Select({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <select
        {...props}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      >
        {children}
      </select>
    </label>
  );
}

function Button({
  children,
  variant = 'primary',
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const base =
    'rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed';
  const styles =
    variant === 'primary'
      ? 'bg-slate-900 text-white hover:bg-teal-700'
      : variant === 'danger'
      ? 'border border-rose-300 text-rose-600 hover:bg-rose-50'
      : 'border border-slate-300 text-slate-600 hover:border-slate-400 hover:text-slate-900';
  return (
    <button type={type} {...props} className={`${base} ${styles} ${props.className || ''}`}>
      {children}
    </button>
  );
}

function Alert({ kind, children }: { kind: 'error' | 'success'; children: React.ReactNode }) {
  const style =
    kind === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-teal-50 text-teal-700 border-teal-200';
  return <div className={`rounded-md border px-3 py-2 text-xs ${style}`}>{children}</div>;
}

function Badge({ children, tone = 'slate', className = '' }: { children: React.ReactNode; tone?: 'slate' | 'teal' | 'rose' | 'amber'; className?: string }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    teal: 'bg-teal-50 text-teal-700',
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-700',
  };
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${tones[tone]} ${className}`}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------

const navItems: { id: Tab; label: string; adminOnly?: boolean; requiresAuth?: boolean }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'auth', label: 'Authentication' },
  { id: 'categories', label: 'Categories' },
  { id: 'products', label: 'Products' },
  { id: 'cart', label: 'Cart', requiresAuth: true },
  { id: 'orders', label: 'Orders', requiresAuth: true },
  { id: 'payments', label: 'Payments', requiresAuth: true },
  { id: 'reviews', label: 'Reviews' },
  { id: 'users', label: 'Users', requiresAuth: true, adminOnly: true },
  { id: 'live', label: 'Live (WebSocket)', requiresAuth: true },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ApiConsolePage() {
  const [health, setHealth] = useState<Health>('checking');
  const [auth, setAuth] = useState<AuthState>({ accessToken: null, user: null });
  const [tab, setTab] = useState<Tab>('overview');
  const [log, setLog] = useState<string[]>([]);
  const [restoringSession, setRestoringSession] = useState(true);

  // --- Top-level WebSocket state (persists across tab switches) ---
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [liveMessages, setLiveMessages] = useState<string[]>([]);
  const [incomingChats, setIncomingChats] = useState<IncomingChat[]>([]);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);

  const changeTab = useCallback((newTab: Tab) => {
    setTab(newTab);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ecommerce_console_tab', newTab);
    }
  }, []);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 12));
  }, []);

  // Health check
  useEffect(() => {
    const base = API_URL.replace(/\/api\/v1$/, '');
    fetch(`${base}/health`)
      .then((res) => setHealth(res.ok ? 'online' : 'offline'))
      .catch(() => setHealth('offline'));
  }, []);

  async function refreshProfile(token: string) {
    const me = await apiFetch<UserProfile>('/users/me', {}, token);
    setAuth({ accessToken: token, user: me });
    return me;
  }

  // Restore tab from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTab = window.localStorage.getItem('ecommerce_console_tab') as Tab;
      if (savedTab) {
        const validTabs: Tab[] = [
          'overview', 'auth', 'categories', 'products', 'cart', 'orders', 'payments', 'reviews', 'users', 'live',
        ];
        if (validTabs.includes(savedTab)) {
          setTab(savedTab);
        }
      }
    }
  }, []);

  // On mount: if a refresh token was saved from a previous session, silently
  // mint a new access token instead of forcing the user to log in again.
  useEffect(() => {
    const savedRefreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!savedRefreshToken) {
      setRestoringSession(false);
      return;
    }

    apiFetch<{ access_token: string }>(`/auth/refresh?refresh_token=${encodeURIComponent(savedRefreshToken)}`, {
      method: 'POST',
    })
      .then(async (data) => {
        const me = await refreshProfile(data.access_token);
        pushLog(`Session restored for ${me.email}`);
      })
      .catch(() => {
        window.localStorage.removeItem(REFRESH_TOKEN_KEY);
        pushLog('Saved session expired — please log in again.');
      })
      .finally(() => setRestoringSession(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect to safe tabs if permissions are not met after session restore completes
  useEffect(() => {
    if (restoringSession) return;
    const currentItem = navItems.find((item) => item.id === tab);
    if (!currentItem) return;

    if (currentItem.requiresAuth && !auth.accessToken) {
      changeTab('auth');
      pushLog(`Redirected from "${currentItem.label}" to Authentication (login required)`);
    } else if (currentItem.adminOnly && !auth.user?.is_superuser) {
      changeTab('overview');
      pushLog(`Redirected from "${currentItem.label}" to Overview (admin access required)`);
    }
  }, [restoringSession, auth.accessToken, auth.user, tab, changeTab, pushLog]);

  // --- WebSocket: connect automatically whenever we have an access token,
  // disconnect when logged out. This keeps a single persistent connection
  // alive no matter which tab is currently active. ---
  const connectWebSocket = useCallback(() => {
    if (!auth.accessToken || wsRef.current) return;
    const wsBase = API_URL.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsBase}/ws?token=${auth.accessToken}`);

    ws.onopen = () => {
      setWsConnected(true);
      pushLog('WebSocket connected');
      setLiveMessages((prev) => [...prev, 'Connected.']);
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'chat_message') {
          setIncomingChats((prev) => [...prev, { from: data.from, message: data.message }]);
          setLiveMessages((prev) => [...prev, `New message from ${data.from}: ${data.message}`]);
        } else if (data.type === 'chat_response') {
          setLiveMessages((prev) => [...prev, `${data.sender}: ${data.message}`]);
        } else if (data.type === 'order_update') {
          setLiveMessages((prev) => [...prev, `Order update: status → ${data.status}`]);
          // Bump this counter so the Orders tab (mounted or not) refetches
          // the next time it's visible / re-renders.
          setOrdersRefreshKey((k) => k + 1);
          pushLog(`Live order update received — status: ${data.status}`);
        } else {
          setLiveMessages((prev) => [...prev, JSON.stringify(data)]);
        }
      } catch {
        setLiveMessages((prev) => [...prev, event.data]);
      }
    };
    ws.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;
      pushLog('WebSocket disconnected');
      setLiveMessages((prev) => [...prev, 'Disconnected.']);
    };
    ws.onerror = () => {
      pushLog('WebSocket error');
    };

    wsRef.current = ws;
  }, [auth.accessToken, pushLog]);

  const disconnectWebSocket = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const sendWsMessage = useCallback((payload: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // Auto-connect once logged in (and once session restore has settled),
  // auto-disconnect on logout.
  useEffect(() => {
    if (restoringSession) return;
    if (auth.accessToken && !wsRef.current) {
      connectWebSocket();
    } else if (!auth.accessToken && wsRef.current) {
      disconnectWebSocket();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken, restoringSession]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  function handleLoginSuccess(accessToken: string, refreshToken: string, user: UserProfile) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    setAuth({ accessToken, user });
    pushLog(`Logged in as ${user.email}${user.is_superuser ? ' (admin)' : ''}`);
  }

  async function handleLogout() {
    try {
      if (auth.accessToken) {
        await apiFetch('/auth/logout', { method: 'POST' }, auth.accessToken);
      }
    } catch {
      // even if the server call fails, still clear the local session
    }
    disconnectWebSocket();
    setLiveMessages([]);
    setIncomingChats([]);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    setAuth({ accessToken: null, user: null });
    pushLog('Logged out');
    changeTab('auth');
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 font-mono text-sm font-bold text-teal-400">
            α
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-800">API Console</h1>
            <p className="font-mono text-[10px] text-slate-400">enterprise-ecommerce</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => {
            if (item.requiresAuth && !auth.accessToken) return null;
            if (item.adminOnly && !auth.user?.is_superuser) return null;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => changeTab(item.id)}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm transition ${
                  tab === item.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3 space-y-1">
          <StatusDot health={health} />
          {auth.accessToken && (
            <div className="flex items-center gap-2 font-mono text-xs tracking-wide text-slate-400">
              <span className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-teal-500' : 'bg-slate-300'}`} />
              {wsConnected ? 'Live updates on' : 'Live updates off'}
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 className="text-sm font-medium capitalize text-slate-700">
            {navItems.find((n) => n.id === tab)?.label}
          </h2>
          {auth.user && (
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-slate-500">
                {auth.user.email} {auth.user.is_superuser && <Badge tone="teal">admin</Badge>}
              </span>
              <Button variant="ghost" onClick={handleLogout}>
                Log out
              </Button>
            </div>
          )}
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">
          {restoringSession && (
            <p className="mb-4 font-mono text-xs text-slate-400">Restoring session…</p>
          )}
          {tab === 'overview' && <OverviewTab auth={auth} log={log} />}
          {tab === 'auth' && (
            <AuthTab
              auth={auth}
              pushLog={pushLog}
              refreshProfile={refreshProfile}
              onLoginSuccess={handleLoginSuccess}
            />
          )}
          {tab === 'categories' && <CategoriesTab auth={auth} pushLog={pushLog} />}
          {tab === 'products' && <ProductsTab auth={auth} pushLog={pushLog} />}
          {tab === 'cart' && auth.accessToken && <CartTab auth={auth} pushLog={pushLog} />}
          {tab === 'orders' && auth.accessToken && (
            <OrdersTab auth={auth} pushLog={pushLog} refreshKey={ordersRefreshKey} />
          )}
          {tab === 'payments' && auth.accessToken && <PaymentsTab auth={auth} pushLog={pushLog} />}
          {tab === 'reviews' && <ReviewsTab auth={auth} pushLog={pushLog} />}
          {tab === 'users' && auth.accessToken && auth.user?.is_superuser && (
            <UsersTab auth={auth} pushLog={pushLog} />
          )}
          {tab === 'live' && auth.accessToken && (
            <LiveTab
              auth={auth}
              connected={wsConnected}
              messages={liveMessages}
              incoming={incomingChats}
              onConnect={connectWebSocket}
              onDisconnect={disconnectWebSocket}
              onSend={sendWsMessage}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewTab({ auth, log }: { auth: AuthState; log: string[] }) {
  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm text-slate-600">
          This console talks directly to your FastAPI backend at{' '}
          <span className="font-mono text-xs text-slate-800">{API_URL}</span>. Use the sidebar to explore
          authentication, catalog, cart, orders, payments, reviews, admin tools, and live WebSocket updates.
        </p>
        {!auth.accessToken && (
          <p className="mt-3 text-sm text-slate-500">
            Start on the <span className="font-medium text-slate-700">Authentication</span> tab to log in
            or register.
          </p>
        )}
      </Card>

      <div>
        <SectionTitle>Activity log</SectionTitle>
        <div className="space-y-1 rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-300">
          {log.length === 0 ? (
            <p className="text-slate-500">No requests yet.</p>
          ) : (
            log.map((line, i) => <p key={i}>{line}</p>)
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function AuthTab({
  auth,
  pushLog,
  refreshProfile,
  onLoginSuccess,
}: {
  auth: AuthState;
  pushLog: (s: string) => void;
  refreshProfile: (token: string) => Promise<UserProfile>;
  onLoginSuccess: (accessToken: string, refreshToken: string, user: UserProfile) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', full_name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (mode === 'register') {
        await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(form) });
        pushLog(`Registered ${form.email}`);
        setSuccess('Account created. If email verification is required, verify before logging in.');
        setMode('login');
      } else {
        const data = await apiFetch<{ access_token: string; refresh_token: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        const me = await refreshProfile(data.access_token);
        onLoginSuccess(data.access_token, data.refresh_token, me);
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (auth.user) {
    return (
      <Card className="max-w-md">
        <p className="mb-2 text-sm text-slate-700">
          Signed in as <span className="font-mono">{auth.user.email}</span>
        </p>
        <div className="space-y-1 font-mono text-[11px] text-slate-500">
          <p>Full name: {auth.user.full_name || '—'}</p>
          <p>Verified: {String(auth.user.is_verified)}</p>
          <p>Admin: {String(auth.user.is_superuser)}</p>
          <p>Joined: {new Date(auth.user.created_at).toLocaleDateString()}</p>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Access token is kept in memory only. A refresh token is saved in your browser so you won't need
          to log in again on reload — log out to clear it.
        </p>
      </Card>
    );
  }

  return (
    <Card className="max-w-md">
      <div className="mb-4 flex gap-1 rounded-md bg-slate-100 p-1 text-xs font-medium">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded px-3 py-1.5 capitalize transition ${
              mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'register' && (
          <Field
            label="Full name"
            name="full_name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
          />
        )}
        <Field
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          minLength={8}
          required
        />
        {error && <Alert kind="error">{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}
        </Button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoriesTab({ auth, pushLog }: { auth: AuthState; pushLog: (s: string) => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Category[]>('/categories/?limit=100');
      setCategories(data);
      pushLog(`GET /categories/ → ${data.length} item(s)`);
    } catch (err: any) {
      pushLog(`GET /categories/ failed — ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [pushLog]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await apiFetch<Category>(
        '/categories/',
        { method: 'POST', body: JSON.stringify(form) },
        auth.accessToken
      );
      pushLog(`Created category "${created.name}"`);
      setForm({ name: '', description: '' });
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        action={
          auth.user?.is_superuser && (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="font-mono text-xs text-teal-700 underline decoration-dotted hover:text-teal-900"
            >
              {showForm ? 'Close' : '+ New category'}
            </button>
          )
        }
      >
        Categories
      </SectionTitle>

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="space-y-3">
            <Field
              label="Name"
              name="category_name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <TextArea
              label="Description"
              name="category_description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
            />
            {error && <Alert kind="error">{error}</Alert>}
            <Button type="submit">Create category</Button>
          </form>
        </Card>
      )}

      {loading ? (
        <p className="font-mono text-xs text-slate-400">Loading…</p>
      ) : categories.length === 0 ? (
        <Card className="text-center text-sm text-slate-400">No categories yet.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {categories.map((c) => (
            <Card key={c.id}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">{c.name}</h3>
                <Badge tone={c.is_active ? 'teal' : 'rose'}>{c.is_active ? 'active' : 'inactive'}</Badge>
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-400">id: {c.id} · slug: {c.slug}</p>
              {c.description && <p className="mt-2 text-xs text-slate-500">{c.description}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function ProductsTab({ auth, pushLog }: { auth: AuthState; pushLog: (s: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', price: '', stock: '', category_id: '' });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadTarget, setUploadTarget] = useState<number | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPrimary, setUploadPrimary] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Product[]>('/products/?limit=50');
      setProducts(data);
      pushLog(`GET /products/ → ${data.length} item(s)`);
    } catch (err: any) {
      pushLog(`GET /products/ failed — ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [pushLog]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const created = await apiFetch<Product>(
        '/products/',
        {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            description: form.description || null,
            price: Number(form.price),
            stock: Number(form.stock),
            category_id: Number(form.category_id),
          }),
        },
        auth.accessToken
      );
      pushLog(`Created product "${created.name}" (id ${created.id})`);
      setSuccess(`"${created.name}" created.`);
      setForm({ name: '', description: '', price: '', stock: '', category_id: '' });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleUpload(productId: number) {
    if (!uploadFile) return;
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      const created = await apiFetch<ProductImage>(
        `/products/${productId}/upload-image?is_primary=${uploadPrimary}`,
        { method: 'POST', body: fd },
        auth.accessToken
      );
      pushLog(`Uploaded image for product ${productId} (image id ${created.id})`);
      setUploadTarget(null);
      setUploadFile(null);
      setUploadPrimary(false);
      load();
    } catch (err: any) {
      setUploadError(err.message);
    }
  }

  async function handleDeleteImage(imageId: number, productId: number) {
    try {
      await apiFetch(`/products/images/${imageId}`, { method: 'DELETE' }, auth.accessToken);
      pushLog(`Deleted image ${imageId} from product ${productId}`);
      load();
    } catch (err: any) {
      pushLog(`Failed to delete image — ${err.message}`);
    }
  }

  async function handleSetPrimaryImage(imageId: number, productId: number) {
    try {
      await apiFetch<ProductImage>(
        `/products/images/${imageId}/set-primary`,
        { method: 'PUT' },
        auth.accessToken
      );
      pushLog(`Set image ${imageId} as primary for product ${productId}`);
      load();
    } catch (err: any) {
      pushLog(`Failed to set primary image — ${err.message}`);
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        action={
          auth.user?.is_superuser && (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="font-mono text-xs text-teal-700 underline decoration-dotted hover:text-teal-900"
            >
              {showForm ? 'Close' : '+ New product'}
            </button>
          )
        }
      >
        Products
      </SectionTitle>

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <p className="col-span-full font-mono text-[11px] text-slate-400">
              Requires an admin account. A category must already exist — create one on the Categories tab
              first.
            </p>
            <Field
              label="Name"
              name="product_name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Field
              label="Category ID"
              name="category_id"
              type="number"
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              required
            />
            <Field
              label="Price"
              name="price"
              type="number"
              step="0.01"
              min="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
            <Field
              label="Stock"
              name="stock"
              type="number"
              min="0"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
              required
            />
            <div className="col-span-full">
              <TextArea
                label="Description"
                name="product_description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
            {error && <Alert kind="error">{error}</Alert>}
            {success && <Alert kind="success">{success}</Alert>}
            <div className="col-span-full">
              <Button type="submit">Create product</Button>
            </div>
          </form>
        </Card>
      )}

      <input
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
      />

      {loading ? (
        <p className="font-mono text-xs text-slate-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card className="text-center text-sm text-slate-400">No products found.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((p) => (
            <Card key={p.id}>
              {p.images.length > 0 && (
                <div className="mb-3 space-y-2">
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {p.images.map((img) => (
                      // "group" lets the hover-action overlay live INSIDE this
                      // box (inset-0), so it can never spill into content
                      // below (like the Upload image button) regardless of
                      // spacing/overflow quirks.
                      <div key={img.id} className="group relative h-24 w-24 shrink-0">
                        <img
                          src={`${API_URL.replace('/api/v1', '')}${img.image_url}`}
                          alt={p.name}
                          className={`h-24 w-24 rounded-md border-2 object-cover ${
                            img.is_primary ? 'border-teal-500' : 'border-slate-200'
                          }`}
                        />
                        {img.is_primary && (
                          <Badge tone="teal" className="absolute -right-2 -top-2 text-[10px]">
                            Primary
                          </Badge>
                        )}
                        {auth.user?.is_superuser && (
                          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 rounded-b-md bg-gradient-to-t from-black/70 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
                            {!img.is_primary && (
                              <button
                                type="button"
                                onClick={() => handleSetPrimaryImage(img.id, p.id)}
                                className="rounded bg-teal-600 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-teal-700"
                              >
                                Primary
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteImage(img.id, p.id)}
                              className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-rose-700"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {auth.user?.is_superuser && (
                    <p className="text-[9px] text-slate-400">Hover over images for actions</p>
                  )}
                </div>
              )}
              <div className="flex items-start justify-between">
                <h3 className="text-sm font-semibold text-slate-800">{p.name}</h3>
                <Badge tone={p.stock > 0 ? 'teal' : 'rose'}>
                  {p.stock > 0 ? `${p.stock} in stock` : 'out of stock'}
                </Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{p.description || 'No description.'}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-slate-900">${p.price}</span>
                <span className="font-mono text-[10px] text-slate-400">{p.images.length} image(s)</span>
              </div>

              {auth.user?.is_superuser && (
                <div className="relative z-10 mt-3 border-t border-slate-100 pt-3">
                  {uploadTarget === p.id ? (
                    <div className="space-y-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                        className="w-full text-xs"
                      />
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        <input
                          type="checkbox"
                          checked={uploadPrimary}
                          onChange={(e) => setUploadPrimary(e.target.checked)}
                        />
                        Set as primary image
                      </label>
                      {uploadError && <Alert kind="error">{uploadError}</Alert>}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className="!px-3 !py-1 text-xs"
                          onClick={() => handleUpload(p.id)}
                          disabled={!uploadFile}
                        >
                          Upload
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="!px-3 !py-1 text-xs"
                          onClick={() => {
                            setUploadTarget(null);
                            setUploadFile(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setUploadTarget(p.id)}
                      className="relative z-10 font-mono text-[11px] text-teal-700 underline decoration-dotted"
                    >
                      Upload image
                    </button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

function CartTab({ auth, pushLog }: { auth: AuthState; pushLog: (s: string) => void }) {
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<CartSummary>('/cart/', {}, auth.accessToken);
      setCart(data);
      pushLog(`GET /cart/ → ${data.total_items} item(s)`);
    } catch (err: any) {
      pushLog(`GET /cart/ failed — ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [auth.accessToken, pushLog]);

  useEffect(() => {
    load();
    apiFetch<Product[]>('/products/?limit=50')
      .then(setProducts)
      .catch(() => {});
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch(
        '/cart/',
        {
          method: 'POST',
          body: JSON.stringify({ product_id: Number(selectedProduct), quantity: Number(quantity) }),
        },
        auth.accessToken
      );
      pushLog(`Added product ${selectedProduct} × ${quantity} to cart`);
      setQuantity('1');
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleUpdate(itemId: number, newQty: number) {
    try {
      await apiFetch(
        `/cart/${itemId}`,
        { method: 'PUT', body: JSON.stringify({ quantity: newQty }) },
        auth.accessToken
      );
      pushLog(`Updated cart item ${itemId} → qty ${newQty}`);
      load();
    } catch (err: any) {
      pushLog(`Update failed — ${err.message}`);
    }
  }

  async function handleRemove(itemId: number) {
    try {
      await apiFetch(`/cart/${itemId}`, { method: 'DELETE' }, auth.accessToken);
      pushLog(`Removed cart item ${itemId}`);
      load();
    } catch (err: any) {
      pushLog(`Remove failed — ${err.message}`);
    }
  }

  async function handleClear() {
    try {
      await apiFetch('/cart/clear/all', { method: 'DELETE' }, auth.accessToken);
      pushLog('Cart cleared');
      load();
    } catch (err: any) {
      pushLog(`Clear failed — ${err.message}`);
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle>Cart</SectionTitle>

      <Card>
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Select label="Product" value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)} required>
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (${p.price})
                </option>
              ))}
            </Select>
          </div>
          <div className="w-24">
            <Field
              label="Qty"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>
          <Button type="submit">Add to cart</Button>
        </form>
        {error && (
          <div className="mt-2">
            <Alert kind="error">{error}</Alert>
          </div>
        )}
      </Card>

      {loading ? (
        <p className="font-mono text-xs text-slate-400">Loading…</p>
      ) : !cart || cart.items.length === 0 ? (
        <Card className="text-center text-sm text-slate-400">Cart is empty.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {cart.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm text-slate-700">{item.product?.name || `Product #${item.product_id}`}</p>
                  <p className="font-mono text-[11px] text-slate-400">
                    ${item.product?.price} × {item.quantity}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    defaultValue={item.quantity}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v > 0 && v !== item.quantity) handleUpdate(item.id, v);
                    }}
                    className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => handleRemove(item.id)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <p className="font-mono text-sm font-semibold text-slate-800">
              Total: ${cart.total_price.toFixed(2)} ({cart.total_items} items)
            </p>
            <Button variant="ghost" onClick={handleClear}>
              Clear cart
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function OrdersTab({
  auth,
  pushLog,
  refreshKey,
}: {
  auth: AuthState;
  pushLog: (s: string) => void;
  refreshKey: number;
}) {
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showAdmin, setShowAdmin] = useState(false);

  const [shippingAddress, setShippingAddress] = useState('');
  const [items, setItems] = useState<{ product_id: number; quantity: number }[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadMyOrders = useCallback(async () => {
    try {
      const data = await apiFetch<Order[]>('/orders/my-orders', {}, auth.accessToken);
      setMyOrders(data);
      pushLog(`GET /orders/my-orders → ${data.length} order(s)`);
    } catch (err: any) {
      pushLog(`GET /orders/my-orders failed — ${err.message}`);
    }
  }, [auth.accessToken, pushLog]);

  const loadAllOrders = useCallback(async () => {
    if (!auth.user?.is_superuser) return;
    try {
      const data = await apiFetch<Order[]>('/orders/', {}, auth.accessToken);
      setAllOrders(data);
      pushLog(`GET /orders/ (admin) → ${data.length} order(s)`);
    } catch (err: any) {
      pushLog(`GET /orders/ failed — ${err.message}`);
    }
  }, [auth.accessToken, auth.user?.is_superuser, pushLog]);

  // Initial load
  useEffect(() => {
    loadMyOrders();
    apiFetch<Product[]>('/products/?limit=50')
      .then(setProducts)
      .catch(() => {});
  }, [loadMyOrders]);

  // Refetch automatically whenever a live order_update broadcast arrives
  // (refreshKey is bumped at the top-level WebSocket handler), regardless
  // of whether the user is looking at this tab when the update happens or
  // switches to it afterward.
  useEffect(() => {
    if (refreshKey === 0) return; // skip on initial mount, already loaded above
    loadMyOrders();
    if (showAdmin) loadAllOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function addItem() {
    if (!selectedProduct) return;
    setItems((prev) => [...prev, { product_id: Number(selectedProduct), quantity: Number(quantity) }]);
    setSelectedProduct('');
    setQuantity('1');
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreateOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (items.length === 0) {
      setError('Add at least one item to the order.');
      return;
    }
    try {
      const created = await apiFetch<Order>(
        '/orders/',
        { method: 'POST', body: JSON.stringify({ shipping_address: shippingAddress, items }) },
        auth.accessToken
      );
      pushLog(`Created order #${created.id} — total $${created.total_price}`);
      setSuccess(`Order #${created.id} created.`);
      setItems([]);
      setShippingAddress('');
      loadMyOrders();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleStatusUpdate(orderId: number, status: string) {
    try {
      await apiFetch(
        `/orders/${orderId}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
        auth.accessToken
      );
      pushLog(`Order #${orderId} status → ${status}`);
      loadAllOrders();
      loadMyOrders();
    } catch (err: any) {
      pushLog(`Status update failed — ${err.message}`);
    }
  }

  function productName(id: number) {
    return products.find((p) => p.id === id)?.name || `Product #${id}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Create order</SectionTitle>
        <Card>
          <form onSubmit={handleCreateOrder} className="space-y-3">
            <TextArea
              label="Shipping address"
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
              rows={2}
              required
            />

            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <Select label="Product" value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
                  <option value="">Select a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (${p.price})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-24">
                <Field label="Qty" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <Button type="button" variant="ghost" onClick={addItem}>
                Add item
              </Button>
            </div>

            {items.length > 0 && (
              <ul className="space-y-1 rounded-md bg-slate-50 p-3">
                {items.map((it, idx) => (
                  <li key={idx} className="flex items-center justify-between text-sm text-slate-600">
                    <span>
                      {productName(it.product_id)} × {it.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="font-mono text-[11px] text-rose-500 hover:underline"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {error && <Alert kind="error">{error}</Alert>}
            {success && <Alert kind="success">{success}</Alert>}
            <Button type="submit">Place order</Button>
          </form>
        </Card>
      </div>

      <div>
        <SectionTitle>My orders</SectionTitle>
        {myOrders.length === 0 ? (
          <Card className="text-center text-sm text-slate-400">No orders yet.</Card>
        ) : (
          <div className="space-y-3">
            {myOrders.map((o) => (
              <Card key={o.id}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">Order #{o.id}</p>
                  <Badge tone="amber">{o.status}</Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  ${o.total_price} · {new Date(o.created_at).toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-slate-500">{o.shipping_address}</p>
                <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-slate-500">
                  {o.items.map((it) => (
                    <li key={it.id}>
                      {productName(it.product_id)} × {it.quantity} — ${it.price}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>

      {auth.user?.is_superuser && (
        <div>
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => {
                  setShowAdmin((v) => !v);
                  if (!showAdmin) loadAllOrders();
                }}
                className="font-mono text-xs text-teal-700 underline decoration-dotted hover:text-teal-900"
              >
                {showAdmin ? 'Hide' : 'Show all orders (admin)'}
              </button>
            }
          >
            Admin: all orders
          </SectionTitle>
          {showAdmin && (
            <div className="space-y-3">
              {allOrders.length === 0 ? (
                <Card className="text-center text-sm text-slate-400">No orders in the system.</Card>
              ) : (
                allOrders.map((o) => (
                  <Card key={o.id}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">
                        Order #{o.id} · user {o.user_id}
                      </p>
                      <Badge tone="amber">{o.status}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">${o.total_price}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        value={o.status}
                        onChange={(e) => handleStatusUpdate(o.id, e.target.value)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      >
                        {ORDER_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <span className="font-mono text-[10px] text-slate-400">update status</span>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

function PaymentsTab({ auth, pushLog }: { auth: AuthState; pushLog: (s: string) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [form, setForm] = useState({ order_id: '', card_number: '', cvv: '', expiry_date: '' });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Payment | null>(null);

  const [lookupOrderId, setLookupOrderId] = useState('');
  const [lookupResult, setLookupResult] = useState<Payment | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Order[]>('/orders/my-orders', {}, auth.accessToken)
      .then(setOrders)
      .catch(() => {});
  }, [auth.accessToken]);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const payment = await apiFetch<Payment>(
        '/payments/',
        {
          method: 'POST',
          body: JSON.stringify({
            order_id: Number(form.order_id),
            card_number: form.card_number,
            cvv: form.cvv,
            expiry_date: form.expiry_date,
          }),
        },
        auth.accessToken
      );
      pushLog(`Payment processed for order #${payment.order_id} — ${payment.status}`);
      setResult(payment);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setLookupError(null);
    setLookupResult(null);
    try {
      const payment = await apiFetch<Payment>(`/payments/order/${lookupOrderId}`, {}, auth.accessToken);
      setLookupResult(payment);
      pushLog(`GET /payments/order/${lookupOrderId} → found`);
    } catch (err: any) {
      setLookupError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Checkout an order</SectionTitle>
        <Card>
          <form onSubmit={handlePay} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="col-span-full">
              <Select
                label="Order"
                value={form.order_id}
                onChange={(e) => setForm({ ...form, order_id: e.target.value })}
                required
              >
                <option value="">Select an order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    #{o.id} — ${o.total_price} ({o.status})
                  </option>
                ))}
              </Select>
            </div>
            <Field
              label="Card number"
              value={form.card_number}
              onChange={(e) => setForm({ ...form, card_number: e.target.value })}
              placeholder="4242 4242 4242 4242"
              required
            />
            <Field
              label="Expiry (MM/YY)"
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              placeholder="12/28"
              required
            />
            <Field
              label="CVV"
              value={form.cvv}
              onChange={(e) => setForm({ ...form, cvv: e.target.value })}
              placeholder="123"
              required
            />
            {error && (
              <div className="col-span-full">
                <Alert kind="error">{error}</Alert>
              </div>
            )}
            {result && (
              <div className="col-span-full">
                <Alert kind="success">
                  Payment #{result.id} — {result.status} — ${result.amount} via {result.provider}
                </Alert>
              </div>
            )}
            <div className="col-span-full">
              <Button type="submit">Pay now</Button>
            </div>
          </form>
        </Card>
      </div>

      <div>
        <SectionTitle>Look up payment by order</SectionTitle>
        <Card>
          <form onSubmit={handleLookup} className="flex items-end gap-3">
            <div className="flex-1">
              <Field
                label="Order ID"
                type="number"
                value={lookupOrderId}
                onChange={(e) => setLookupOrderId(e.target.value)}
                required
              />
            </div>
            <Button type="submit">Look up</Button>
          </form>
          {lookupError && (
            <div className="mt-2">
              <Alert kind="error">{lookupError}</Alert>
            </div>
          )}
          {lookupResult && (
            <div className="mt-3 rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-600">
              <p>Payment #{lookupResult.id}</p>
              <p>Status: {lookupResult.status}</p>
              <p>Amount: ${lookupResult.amount}</p>
              <p>Provider: {lookupResult.provider}</p>
              <p>Transaction: {lookupResult.transaction_id || '—'}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

function ReviewsTab({ auth, pushLog }: { auth: AuthState; pushLog: (s: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ rating: '5', comment: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Product[]>('/products/?limit=50')
      .then(setProducts)
      .catch(() => {});
  }, []);

  const loadReviews = useCallback(
    async (productId: string) => {
      if (!productId) return;
      setLoading(true);
      try {
        const data = await apiFetch<Review[]>(`/reviews/product/${productId}?limit=50`);
        setReviews(data);
        pushLog(`GET /reviews/product/${productId} → ${data.length} review(s)`);
      } catch (err: any) {
        pushLog(`GET reviews failed — ${err.message}`);
      } finally {
        setLoading(false);
      }
    },
    [pushLog]
  );

  useEffect(() => {
    if (selectedProduct) loadReviews(selectedProduct);
    else setReviews([]);
  }, [selectedProduct, loadReviews]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!auth.accessToken) {
      setError('Log in to leave a review.');
      return;
    }
    try {
      await apiFetch(
        '/reviews/',
        {
          method: 'POST',
          body: JSON.stringify({
            product_id: Number(selectedProduct),
            rating: Number(form.rating),
            comment: form.comment || null,
          }),
        },
        auth.accessToken
      );
      pushLog(`Submitted review for product ${selectedProduct}`);
      setForm({ rating: '5', comment: '' });
      loadReviews(selectedProduct);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle>Reviews</SectionTitle>

      <Card>
        <Select label="Product" value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
          <option value="">Select a product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Card>

      {selectedProduct && (
        <>
          {auth.accessToken && (
            <Card>
              <form onSubmit={handleSubmit} className="space-y-3">
                <Select label="Rating" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>
                      {r} star{r > 1 ? 's' : ''}
                    </option>
                  ))}
                </Select>
                <TextArea
                  label="Comment"
                  value={form.comment}
                  onChange={(e) => setForm({ ...form, comment: e.target.value })}
                  rows={2}
                />
                {error && <Alert kind="error">{error}</Alert>}
                <Button type="submit">Submit review</Button>
              </form>
            </Card>
          )}

          {loading ? (
            <p className="font-mono text-xs text-slate-400">Loading…</p>
          ) : reviews.length === 0 ? (
            <Card className="text-center text-sm text-slate-400">No reviews yet for this product.</Card>
          ) : (
            <div className="space-y-2">
              {reviews.map((r) => (
                <Card key={r.id}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">{r.user.full_name}</p>
                    <Badge tone="amber">{'★'.repeat(r.rating)}</Badge>
                  </div>
                  {r.comment && <p className="mt-1 text-xs text-slate-500">{r.comment}</p>}
                  <p className="mt-1 font-mono text-[10px] text-slate-400">
                    {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users (admin only)
// ---------------------------------------------------------------------------

function UsersTab({ auth, pushLog }: { auth: AuthState; pushLog: (s: string) => void }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<UserProfile[]>('/users/?limit=100', {}, auth.accessToken)
      .then((data) => {
        setUsers(data);
        pushLog(`GET /users/ → ${data.length} user(s)`);
      })
      .catch((err: any) => pushLog(`GET /users/ failed — ${err.message}`))
      .finally(() => setLoading(false));
  }, [auth.accessToken, pushLog]);

  return (
    <div className="space-y-4">
      <SectionTitle>All users (admin)</SectionTitle>
      {loading ? (
        <p className="font-mono text-xs text-slate-400">Loading…</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 font-mono text-[11px] uppercase tracking-wider text-slate-400">
                <th className="py-2 pr-4">ID</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Active</th>
                <th className="py-2 pr-4">Verified</th>
                <th className="py-2 pr-4">Admin</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 text-slate-600">
                  <td className="py-2 pr-4 font-mono text-xs">{u.id}</td>
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">{u.full_name || '—'}</td>
                  <td className="py-2 pr-4">{u.is_active ? '✓' : '—'}</td>
                  <td className="py-2 pr-4">{u.is_verified ? '✓' : '—'}</td>
                  <td className="py-2 pr-4">{u.is_superuser ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live (WebSocket) — now a "dumb" component driven by props. The actual
// connection lives at the top level (ApiConsolePage) so it persists across
// tab switches.
// ---------------------------------------------------------------------------

function LiveTab({
  auth,
  connected,
  messages,
  incoming,
  onConnect,
  onDisconnect,
  onSend,
}: {
  auth: AuthState;
  connected: boolean;
  messages: string[];
  incoming: IncomingChat[];
  onConnect: () => void;
  onDisconnect: () => void;
  onSend: (payload: object) => void;
}) {
  const isAdmin = !!auth.user?.is_superuser;
  const [chatInput, setChatInput] = useState('');
  const [replyTarget, setReplyTarget] = useState('');
  const [replyText, setReplyText] = useState('');

  function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSend({ type: 'chat', message: chatInput });
    setChatInput('');
  }

  function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyTarget || !replyText.trim()) return;
    onSend({ type: 'chat_reply', to: replyTarget, message: replyText });
    setReplyText('');
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        action={
          connected ? (
            <Button variant="ghost" onClick={onDisconnect}>
              Disconnect
            </Button>
          ) : (
            <Button onClick={onConnect}>Connect</Button>
          )
        }
      >
        Live (chat &amp; order updates)
      </SectionTitle>

      <Card>
        <div className="mb-3 flex items-center gap-2 font-mono text-xs text-slate-400">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-teal-500' : 'bg-slate-300'}`} />
          {connected ? 'connected' : 'not connected'}
          {isAdmin && <Badge tone="teal">admin — receives customer messages</Badge>}
        </div>

        <div className="mb-3 h-64 space-y-1 overflow-y-auto rounded-md bg-slate-900 p-3 font-mono text-[11px] text-slate-300">
          {messages.length === 0 ? (
            <p className="text-slate-500">
              No messages yet. {isAdmin ? 'Waiting for a customer message.' : 'Send a message below.'}
            </p>
          ) : (
            messages.map((m, i) => <p key={i}>{m}</p>)
          )}
        </div>

        {isAdmin ? (
          <>
            {incoming.length > 0 && (
              <div className="mb-3 space-y-2">
                <p className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
                  Incoming customer messages
                </p>
                {incoming.map((msg, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs">
                    <span className="text-slate-600">
                      <span className="font-mono text-slate-400">{msg.from}:</span> {msg.message}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyTarget(msg.from)}
                      className="font-mono text-[11px] text-teal-700 underline decoration-dotted"
                    >
                      Reply
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={sendReply} className="flex gap-2">
              <input
                value={replyTarget}
                onChange={(e) => setReplyTarget(e.target.value)}
                disabled={!connected}
                placeholder="Customer email to reply to…"
                className="w-56 rounded-md border border-slate-300 px-3 py-2 text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50"
              />
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={!connected}
                placeholder="Type your reply…"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50"
              />
              <Button type="submit" disabled={!connected || !replyTarget}>
                Reply
              </Button>
            </form>
          </>
        ) : (
          <form onSubmit={sendChat} className="flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={!connected}
              placeholder="Message support…"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50"
            />
            <Button type="submit" disabled={!connected}>
              Send
            </Button>
          </form>
        )}

        <p className="mt-2 font-mono text-[11px] text-slate-400">
          {isAdmin
            ? 'Messages from any connected customer appear above. Reply by entering their email and a message.'
            : 'An admin must be connected for their Live tab to see and reply to your message.'}
          {' '}Order status changes appear here — and on the Orders tab — in real time, automatically.
        </p>
      </Card>
    </div>
  );
}