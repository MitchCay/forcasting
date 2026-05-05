// Tiny fetch wrapper. All API calls go through here so we have one place to
// add auth/error handling/etc later.
export async function api<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, headers, ...rest } = init ?? {}
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : (rest.body as BodyInit | null | undefined),
    ...rest,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${detail || res.statusText}`)
  }

  // No-content responses
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
