// Calls to this app's own serverless endpoints (which forward to your AI provider).

async function post(path, body) {
  let res, data = null, text = '';
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    text = await res.text();
    try { data = JSON.parse(text); } catch { data = null; }
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  if (!res.ok || !data || data.error) {
    if (data && data.error && data.error.message) throw new Error(data.error.message);
    if (res.status === 504 || /FUNCTION_INVOCATION_TIMEOUT|timed out/i.test(text)) throw new Error('The request timed out on the server. Try a faster model or lower Max tokens in Settings.');
    if (res.status === 413) throw new Error('That request is too large. Try smaller attachments.');
    throw new Error(`Request failed (${res.status}).`);
  }
  return data;
}

export const api = {
  config: async () => { try { const r = await fetch('/api/config'); return r.ok ? await r.json() : {}; } catch { return {}; } },
  report: body => post('/api/report', body),
  consult: body => post('/api/consult', body),
  brief: body => post('/api/brief', body),
  test: body => post('/api/test', body)
};
