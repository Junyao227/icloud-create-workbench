/** 开发环境通过 Skyroc 代理访问 Node.js，生产环境保持同源。 */
function apiPath(path: string) {
  return `${import.meta.env.DEV ? '/proxy-default' : ''}${path}`;
}

/** 统一发送带 Cookie 的工作台请求。 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiPath(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('登录已过期');
  }
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data as T;
}

/** 发送请求并把文本响应保存为本地下载文件。 */
export async function downloadTextFile(path: string, options: RequestInit = {}, fallbackName = 'download.txt') {
  const response = await fetch(apiPath(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('登录已过期');
  }
  const text = await response.text();
  if (!response.ok) {
    let error: { error?: string } = {};
    try {
      error = JSON.parse(text || '{}') as { error?: string };
    } catch {
      error = {};
    }
    throw new Error(error.error || `请求失败：${response.status}`);
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] || fallbackName;
  const url = URL.createObjectURL(new Blob([text], { type: response.headers.get('Content-Type') || 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 将查询参数转换为 URL 查询字符串。 */
export function queryString(values: Record<string, number | string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}
