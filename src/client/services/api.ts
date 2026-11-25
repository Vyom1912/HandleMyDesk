import { AppEvent } from '../../types';

export const STORAGE_TOKEN_KEY = 'novadesk_token';

/*
 * The session lives in sessionStorage, which belongs to a single browser tab. Every tab (and
 * every device) signs in on its own, so two people can work side by side in one browser
 * without one sign-in replacing the other. It still survives reloading the tab.
 */
try {
  // Sessions used to be shared by all tabs through localStorage; drop that old copy
  localStorage.removeItem(STORAGE_TOKEN_KEY);
} catch {
  // Storage unavailable
}

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(STORAGE_TOKEN_KEY, token);
    else sessionStorage.removeItem(STORAGE_TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the session just won't survive a reload
  }
}

// Fired when the server rejects our token, so the app can return to the sign-in screen
export const UNAUTHORIZED_EVENT = 'novadesk-unauthorized';

function authHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init || {});
  const token = getStoredToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

async function errorFrom(response: Response): Promise<Error> {
  if (response.status === 401 && getStoredToken()) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
  let message = response.statusText || 'An error occurred';
  try {
    const data = await response.json();
    message = data.error || message;
  } catch {
    // Non-JSON error body
  }
  return new Error(message);
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = authHeaders(options.headers);
  // FormData sets its own multipart boundary
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(endpoint, { ...options, headers });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }

  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export const api = {
  get: <T>(url: string) => request<T>(url, { method: 'GET' }),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
  upload: <T>(url: string, form: FormData) => request<T>(url, { method: 'POST', body: form }),

  // Downloads need the auth header, so fetch the file and hand the browser a blob URL
  download: async (url: string, filename: string) => {
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) throw await errorFrom(response);
    const blobUrl = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  },
};

/**
 * Subscribes to the server's live event stream. Uses fetch rather than EventSource so the
 * token travels in a header instead of the URL. Reconnects with backoff; returns a stop function.
 */
export function openEventStream(onEvent: (event: AppEvent) => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let retryDelay = 1000;

  const connect = async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        const response = await fetch('/api/events', { headers: authHeaders(), signal: controller.signal });
        if (response.status === 401) {
          window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
          return;
        }
        if (!response.ok || !response.body) throw new Error('stream unavailable');
        retryDelay = 1000;

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => line.slice(6))
              .join('\n');
            if (data) {
              try {
                onEvent(JSON.parse(data));
              } catch {
                // Ignore malformed frames
              }
            }
          }
        }
      } catch {
        // Network drop or abort; fall through to retry
      }
      if (stopped) return;
      await new Promise((r) => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  };

  connect();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
