// Tiny helpers shared by the API handlers (work on Vercel and in server.js).

class BadRequest extends Error { constructor(m) { super(m); this.status = 400; } }

function route(methods, fn) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        return res.status(405).json({ error: { message: 'Method not allowed.' } });
      }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new BadRequest('Request body must be JSON.'); } }
      const out = await fn(body && typeof body === 'object' ? body : {}, req);
      return res.status(200).json(out);
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : (/Settings|model|key|URL|provider|base/i.test(e.message || '') ? 400 : 500);
      if (status === 500) console.error(e);
      return res.status(status).json({ error: { message: e.message || 'Unexpected server error.' } });
    }
  };
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_ATTACH_B64 = 4.2 * 1024 * 1024; // Vercel functions accept ~4.5MB request bodies

// Validates attachments from the browser and converts them to neutral message parts.
function attachmentParts(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > 4) throw new BadRequest('Attach at most 1 PDF and 3 images.');
  let total = 0;
  return list.map(a => {
    if (!a || typeof a.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(a.data)) throw new BadRequest('An attachment is not valid base64 data.');
    total += a.data.length;
    if (total > MAX_ATTACH_B64) throw new BadRequest('Attachments are too large. Keep them under about 3 MB in total.');
    if (a.type === 'pdf') return { type: 'pdf', name: String(a.name || 'document.pdf').slice(0, 120), data: a.data };
    if (a.type === 'image' && IMAGE_TYPES.has(a.mediaType)) return { type: 'image', mediaType: a.mediaType, data: a.data };
    throw new BadRequest('Unsupported attachment type. Use a PDF or PNG/JPEG/GIF/WebP image.');
  });
}

function str(v, max, label) {
  if (typeof v !== 'string') return '';
  if (v.length > max) throw new BadRequest(`${label || 'Text'} is too long (max ${max} characters).`);
  return v;
}

module.exports = { route, BadRequest, attachmentParts, str };
