import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SECRET_CODE = process.env.SECRET_CODE || 'CHANGE_ME';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function normalizeKey(str) {
  return str.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlPage(title, content) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:20px;background:#fafafa;color:#333}
h1{border-bottom:2px solid #ddd;padding-bottom:10px}
a{color:#0066cc}
.highlight{background:white;border-left:4px solid #0066cc;padding:15px 20px;margin:15px 0;box-shadow:0 1px 3px rgba(0,0,0,0.1);position:relative}
.highlight-text{font-style:italic;font-size:1.1em}
.highlight-meta{font-size:0.85em;color:#888;margin-top:10px}
.highlight-actions{position:absolute;top:10px;right:10px}
.delete-btn{background:#cc0000;color:white;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:12px}
.delete-btn:hover{background:#aa0000}
.book-card{background:white;padding:15px 20px;margin:10px 0;box-shadow:0 1px 3px rgba(0,0,0,0.1);display:flex;justify-content:space-between;align-items:center}
.book-count{background:#0066cc;color:white;padding:5px 12px;border-radius:20px}
.nav{background:#333;padding:10px 20px;margin:-20px -20px 20px -20px}
.nav a{color:white;margin-right:20px;text-decoration:none}
.stats{display:flex;gap:30px;margin:20px 0}
.stat{background:white;padding:15px 25px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
.stat-number{font-size:2em;font-weight:bold;color:#0066cc}
.export-links a,.action-btn{margin-right:15px;padding:8px 15px;background:#0066cc;color:white;border-radius:4px;text-decoration:none;border:none;cursor:pointer;font-size:14px;display:inline-block}
.action-btn.danger{background:#cc0000}
.action-btn.danger:hover{background:#aa0000}
.search-box{width:100%;padding:12px;font-size:16px;border:1px solid #ddd;border-radius:4px;margin-bottom:20px}
</style>
<script>
function deleteHighlight(id, bookKey) {
  if (!confirm('Delete this highlight?')) return;
  fetch('/delete/highlight/' + id + '?book=' + bookKey, { method: 'POST' })
    .then(r => r.json())
    .then(d => { if (d.success) location.reload(); else alert('Error: ' + d.error); })
    .catch(e => alert('Error: ' + e));
}
function deleteBook(bookKey) {
  if (!confirm('Delete this book and ALL its highlights? This cannot be undone.')) return;
  fetch('/delete/book/' + bookKey, { method: 'POST' })
    .then(r => r.json())
    .then(d => { if (d.success) location.href = '/books'; else alert('Error: ' + d.error); })
    .catch(e => alert('Error: ' + e));
}
function deleteMarkedBook(bookKey) {
  if (!confirm('Delete this marked text export?')) return;
  fetch('/delete/marked/' + bookKey, { method: 'POST' })
    .then(r => r.json())
    .then(d => { if (d.success) location.href = '/marked'; else alert('Error: ' + d.error); })
    .catch(e => alert('Error: ' + e));
}
</script>
</head><body>
<nav class="nav"><a href="/">Home</a><a href="/books">Books</a><a href="/marked">Marked</a><a href="/search">Search</a><a href="/export">Export</a></nav>
${content}
</body></html>`;
}

async function safeGet(key) {
  try {
    const val = await redis.get(key);
    if (val === null || val === undefined) return null;
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  } catch (e) {
    console.error('Redis get error:', key, e);
    return null;
  }
}

async function safeGetArray(key) {
  const val = await safeGet(key);
  if (Array.isArray(val)) return val;
  return [];
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://example.com');
  const path = url.pathname;

  try {
    // POST /create
    if (req.method === 'POST' && path === '/create') {
      const { code, text, title, author, chapter } = req.body;
      if (!code || code.toUpperCase() !== SECRET_CODE.toUpperCase()) {
        return res.status(403).json({ error: 'Invalid code' });
      }
      if (!text || !title || !author) {
        return res.status(400).json({ error: 'Missing fields' });
      }
      const id = generateId();
      const highlight = { id, text: text.trim(), title: title.trim(), author: author.trim(), chapter: chapter?.trim(), created_at: new Date().toISOString() };
      const bookKey = normalizeKey(`${author}_${title}`);
      
      await redis.set(`highlight:${id}`, highlight);
      
      const bookHighlights = await safeGetArray(`book_highlights:${bookKey}`);
      bookHighlights.push(id);
      await redis.set(`book_highlights:${bookKey}`, bookHighlights);
      
      const book = await safeGet(`book:${bookKey}`) || { title: title.trim(), author: author.trim(), highlight_count: 0 };
      book.highlight_count = (book.highlight_count || 0) + 1;
      book.last_updated = highlight.created_at;
      await redis.set(`book:${bookKey}`, book);
      
      const books = await safeGetArray('books');
      if (!books.includes(bookKey)) { 
        books.push(bookKey); 
        await redis.set('books', books); 
      }
      
      const allHighlights = await safeGetArray('all_highlights');
      allHighlights.unshift(id);
      await redis.set('all_highlights', allHighlights);
      
      return res.status(200).json({ success: true, id });
    }

    // POST /upload_book - Upload full marked text export
    if (req.method === 'POST' && path === '/upload_book') {
      const { code, title, author, content } = req.body;
      if (!code || code.toUpperCase() !== SECRET_CODE.toUpperCase()) {
        return res.status(403).json({ error: 'Invalid code' });
      }
      if (!title || !content) {
        return res.status(400).json({ error: 'Missing title or content' });
      }
      
      const bookKey = normalizeKey(`${author || 'Unknown'}_${title}`);
      const id = generateId();
      
      const markedBook = {
        id,
        title: title.trim(),
        author: (author || 'Unknown').trim(),
        content: content,
        created_at: new Date().toISOString(),
      };
      
      await redis.set(`marked_book:${bookKey}`, markedBook);
      
      // Track in list of marked books
      const markedBooks = await safeGetArray('marked_books');
      if (!markedBooks.includes(bookKey)) {
        markedBooks.push(bookKey);
        await redis.set('marked_books', markedBooks);
      }
      
      return res.status(200).json({ success: true, id, bookKey });
    }

    // POST /bulk_create
    if (req.method === 'POST' && path === '/bulk_create') {
      const { code, title, author, bookmarks } = req.body;
      if (!code || code.toUpperCase() !== SECRET_CODE.toUpperCase()) {
        return res.status(403).json({ error: 'Invalid code' });
      }
      if (!title || !author || !bookmarks || !Array.isArray(bookmarks)) {
        return res.status(400).json({ error: 'Missing fields' });
      }
      
      const bookKey = normalizeKey(`${author}_${title}`);
      let addedCount = 0;
      
      const bookHighlights = await safeGetArray(`book_highlights:${bookKey}`);
      const allHighlights = await safeGetArray('all_highlights');
      
      for (const bookmark of bookmarks) {
        const text = bookmark.text_orig || bookmark.text || (typeof bookmark === 'string' ? bookmark : null);
        if (!text) continue;
        
        const id = generateId();
        const highlight = { id, text: text.trim(), title: title.trim(), author: author.trim(), created_at: new Date().toISOString() };
        
        await redis.set(`highlight:${id}`, highlight);
        bookHighlights.push(id);
        allHighlights.unshift(id);
        addedCount++;
      }
      
      await redis.set(`book_highlights:${bookKey}`, bookHighlights);
      await redis.set('all_highlights', allHighlights);
      
      const book = await safeGet(`book:${bookKey}`) || { title: title.trim(), author: author.trim(), highlight_count: 0 };
      book.highlight_count = (book.highlight_count || 0) + addedCount;
      book.last_updated = new Date().toISOString();
      await redis.set(`book:${bookKey}`, book);
      
      const books = await safeGetArray('books');
      if (!books.includes(bookKey)) { 
        books.push(bookKey); 
        await redis.set('books', books); 
      }
      
      return res.status(200).json({ success: true, added: addedCount });
    }

    // POST /coldturkey/trigger - Queue a block command
    if (req.method === 'POST' && path === '/coldturkey/trigger') {
      const { code, block, minutes } = req.body;
      
      if (!code || code.toUpperCase() !== SECRET_CODE.toUpperCase()) {
        return res.status(401).json({ error: 'Invalid code' });
      }
      
      const allowedBlocks = ['AI', 'DGD', 'Jobs', 'reddit', 'The whole internet'];
      if (!allowedBlocks.includes(block)) {
        return res.status(400).json({ error: 'Invalid block name' });
      }
      
      const validMinutes = [30, 60, 120, 240, 480, 720, 1440];
      if (!validMinutes.includes(parseInt(minutes))) {
        return res.status(400).json({ error: 'Invalid duration' });
      }
      
      await redis.set('coldturkey:pending', JSON.stringify({
        block,
        minutes: parseInt(minutes),
        timestamp: Date.now()
      }));
      
      await redis.expire('coldturkey:pending', 60);
      
      return res.status(200).json({ success: true, message: `${block} queued for ${minutes} min` });
    }

    // GET /coldturkey/check - PC polls this for pending commands
    if (req.method === 'GET' && path === '/coldturkey/check') {
      const code = url.searchParams.get('code');
      
      if (!code || code.toUpperCase() !== SECRET_CODE.toUpperCase()) {
        return res.status(401).json({ error: 'Invalid code' });
      }
      
      const pending = await redis.get('coldturkey:pending');
      if (pending) {
        await redis.del('coldturkey:pending');
        const data = typeof pending === 'string' ? JSON.parse(pending) : pending;
        return res.status(200).json(data);
      } else {
        return res.status(200).json(null);
      }
    }

    // POST /delete/highlight/:id
    if (req.method === 'POST' && path.startsWith('/delete/highlight/')) {
      const id = path.replace('/delete/highlight/', '');
      const bookKey = url.searchParams.get('book');
      
      // Delete the highlight
      await redis.del(`highlight:${id}`);
      
      // Remove from book's highlight list
      if (bookKey) {
        const bookHighlights = await safeGetArray(`book_highlights:${bookKey}`);
        const filtered = bookHighlights.filter(hid => hid !== id);
        await redis.set(`book_highlights:${bookKey}`, filtered);
        
        // Update book count
        const book = await safeGet(`book:${bookKey}`);
        if (book) {
          book.highlight_count = Math.max(0, (book.highlight_count || 1) - 1);
          await redis.set(`book:${bookKey}`, book);
        }
      }
      
      // Remove from all highlights list
      const allHighlights = await safeGetArray('all_highlights');
      const filteredAll = allHighlights.filter(hid => hid !== id);
      await redis.set('all_highlights', filteredAll);
      
      return res.status(200).json({ success: true });
    }

    // POST /delete/marked/:key
    if (req.method === 'POST' && path.startsWith('/delete/marked/')) {
      const bookKey = path.replace('/delete/marked/', '');
      
      await redis.del(`marked_book:${bookKey}`);
      
      const markedBooks = await safeGetArray('marked_books');
      const filtered = markedBooks.filter(k => k !== bookKey);
      await redis.set('marked_books', filtered);
      
      return res.status(200).json({ success: true });
    }

    // POST /delete/book/:key
    if (req.method === 'POST' && path.startsWith('/delete/book/')) {
      const bookKey = path.replace('/delete/book/', '');
      
      // Get all highlight IDs for this book
      const bookHighlights = await safeGetArray(`book_highlights:${bookKey}`);
      
      // Delete each highlight
      for (const id of bookHighlights) {
        await redis.del(`highlight:${id}`);
      }
      
      // Remove highlights from all_highlights list
      const allHighlights = await safeGetArray('all_highlights');
      const filteredAll = allHighlights.filter(id => !bookHighlights.includes(id));
      await redis.set('all_highlights', filteredAll);
      
      // Delete book data
      await redis.del(`book_highlights:${bookKey}`);
      await redis.del(`book:${bookKey}`);
      
      // Remove from books list
      const books = await safeGetArray('books');
      const filteredBooks = books.filter(k => k !== bookKey);
      await redis.set('books', filteredBooks);
      
      return res.status(200).json({ success: true });
    }

    // GET pages
    if (req.method === 'GET') {
      // GET /coldturkey - Control page
      if (path === '/coldturkey') {
        const html = `<!DOCTYPE html>
<html>
<head>
  <title>Cold Turkey Remote</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 400px;
      margin: 0 auto;
      padding: 20px;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
    }
    h1 {
      text-align: center;
      color: #00d9ff;
      margin-bottom: 30px;
    }
    .auth-section {
      margin-bottom: 30px;
    }
    input[type="password"] {
      width: 100%;
      padding: 12px;
      font-size: 16px;
      border: 2px solid #333;
      border-radius: 8px;
      background: #0f0f1a;
      color: #fff;
    }
    .duration-section {
      margin-bottom: 20px;
    }
    select {
      width: 100%;
      padding: 12px;
      font-size: 16px;
      border: 2px solid #333;
      border-radius: 8px;
      background: #0f0f1a;
      color: #fff;
    }
    .blocks {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    button {
      padding: 16px;
      font-size: 18px;
      font-weight: bold;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: transform 0.1s, opacity 0.1s;
    }
    button:active {
      transform: scale(0.98);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-ai { background: #e74c3c; color: white; }
    .btn-dgd { background: #9b59b6; color: white; }
    .btn-jobs { background: #3498db; color: white; }
    .btn-reddit { background: #ff4500; color: white; }
    .btn-nuclear { background: #2c3e50; color: white; border: 3px solid #e74c3c; }
    .status {
      margin-top: 20px;
      padding: 12px;
      border-radius: 8px;
      text-align: center;
      display: none;
    }
    .status.success { background: #27ae60; display: block; }
    .status.error { background: #c0392b; display: block; }
    .status.loading { background: #2980b9; display: block; }
    label {
      display: block;
      margin-bottom: 8px;
      color: #888;
    }
  </style>
</head>
<body>
  <h1>🦃 Cold Turkey</h1>
  
  <div class="auth-section">
    <label>Verification Code</label>
    <input type="password" id="code" placeholder="Enter code">
  </div>
  
  <div class="duration-section">
    <label>Duration</label>
    <select id="duration">
      <option value="30">30 minutes</option>
      <option value="60">1 hour</option>
      <option value="120" selected>2 hours</option>
      <option value="240">4 hours</option>
      <option value="480">8 hours</option>
      <option value="720">12 hours</option>
      <option value="1440">24 hours</option>
    </select>
  </div>
  
  <div class="blocks">
    <button class="btn-ai" onclick="trigger('AI')">Block AI</button>
    <button class="btn-dgd" onclick="trigger('DGD')">Block DGD</button>
    <button class="btn-jobs" onclick="trigger('Jobs')">Block Jobs</button>
    <button class="btn-reddit" onclick="trigger('reddit')">Block Reddit</button>
    <button class="btn-nuclear" onclick="trigger('The whole internet')">🚨 BLOCK EVERYTHING 🚨</button>
  </div>
  
  <div id="status" class="status"></div>
  
  <script>
    const codeInput = document.getElementById('code');
    codeInput.value = localStorage.getItem('ct_code') || '';
    codeInput.addEventListener('input', () => {
      localStorage.setItem('ct_code', codeInput.value);
    });
    
    const durationSelect = document.getElementById('duration');
    durationSelect.value = localStorage.getItem('ct_duration') || '120';
    durationSelect.addEventListener('change', () => {
      localStorage.setItem('ct_duration', durationSelect.value);
    });
    
    async function trigger(block) {
      const code = document.getElementById('code').value;
      const minutes = document.getElementById('duration').value;
      const status = document.getElementById('status');
      
      if (!code) {
        status.className = 'status error';
        status.textContent = 'Enter verification code';
        return;
      }
      
      if (block === 'The whole internet') {
        if (!confirm('Block THE ENTIRE INTERNET for ' + (parseInt(minutes) >= 60 ? (minutes/60) + ' hours' : minutes + ' minutes') + '?')) {
          return;
        }
      }
      
      status.className = 'status loading';
      status.textContent = 'Sending...';
      
      try {
        const response = await fetch('/coldturkey/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, block, minutes: parseInt(minutes) })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          status.className = 'status success';
          status.textContent = '✓ ' + data.message;
        } else {
          status.className = 'status error';
          status.textContent = data.error || 'Failed';
        }
      } catch (e) {
        status.className = 'status error';
        status.textContent = 'Connection error';
      }
      
      setTimeout(() => {
        status.className = 'status';
      }, 3000);
    }
  </script>
</body>
</html>`;
        return res.status(200).send(html);
      }

      if (path === '/' || path === '') {
        const allIds = await safeGetArray('all_highlights');
        const bookKeys = await safeGetArray('books');
        const recent = [];
        for (const id of allIds.slice(0, 10)) {
          const h = await safeGet(`highlight:${id}`);
          if (h) recent.push(h);
        }
        const content = `<h1>📚 My Highlights</h1>
          <div class="stats"><div class="stat"><div class="stat-number">${allIds.length}</div><div>Highlights</div></div>
          <div class="stat"><div class="stat-number">${bookKeys.length}</div><div>Books</div></div></div>
          <h2>Recent</h2>
          ${recent.map(h => `<div class="highlight"><div class="highlight-text">"${escapeHtml(h.text)}"</div>
          <div class="highlight-meta"><strong>${escapeHtml(h.author)}</strong> — ${escapeHtml(h.title)}</div></div>`).join('')}`;
        return res.status(200).send(htmlPage('Home', content));
      }

      if (path === '/books') {
        const bookKeys = await safeGetArray('books');
        const books = [];
        for (const key of bookKeys) {
          const b = await safeGet(`book:${key}`);
          if (b) books.push({ ...b, key });
        }
        const content = `<h1>📖 Books (${books.length})</h1>
          ${books.map(b => `<a href="/book/${b.key}" style="text-decoration:none;color:inherit">
          <div class="book-card"><div><h3 style="margin:0">${escapeHtml(b.title)}</h3><p style="margin:0;color:#666">${escapeHtml(b.author)}</p></div>
          <div class="book-count">${b.highlight_count || 0}</div></div></a>`).join('')}`;
        return res.status(200).send(htmlPage('Books', content));
      }

      if (path === '/search') {
        const q = url.searchParams.get('q') || '';
        let resultsHtml = '';
        if (q) {
          const allIds = await safeGetArray('all_highlights');
          const results = [];
          for (const id of allIds) {
            const h = await safeGet(`highlight:${id}`);
            if (h && (h.text?.toLowerCase().includes(q.toLowerCase()) || h.title?.toLowerCase().includes(q.toLowerCase()) || h.author?.toLowerCase().includes(q.toLowerCase()))) {
              results.push(h);
            }
          }
          resultsHtml = `<p>${results.length} results</p>${results.map(h => `<div class="highlight"><div class="highlight-text">"${escapeHtml(h.text)}"</div><div class="highlight-meta"><strong>${escapeHtml(h.author)}</strong> — ${escapeHtml(h.title)}</div></div>`).join('')}`;
        }
        const content = `<h1>🔍 Search</h1><form method="GET"><input type="text" name="q" class="search-box" placeholder="Search..." value="${escapeHtml(q)}"></form>${resultsHtml}`;
        return res.status(200).send(htmlPage('Search', content));
      }

      if (path === '/export') {
        const content = `<h1>📤 Export</h1><h2>All Highlights</h2><div class="export-links"><a href="/export/all?format=md">Markdown</a><a href="/export/all?format=json">JSON</a></div>`;
        return res.status(200).send(htmlPage('Export', content));
      }

      if (path === '/marked') {
        const markedBookKeys = await safeGetArray('marked_books');
        const books = [];
        for (const key of markedBookKeys) {
          const b = await safeGet(`marked_book:${key}`);
          if (b) books.push({ ...b, key });
        }
        const content = `<h1>📝 Marked Text Exports (${books.length})</h1>
          ${books.length === 0 ? '<p>No marked text exports yet. Send from KOReader using the Marked Text Export plugin.</p>' : ''}
          ${books.map(b => `<div class="book-card">
            <div><h3 style="margin:0">${escapeHtml(b.title)}</h3><p style="margin:0;color:#666">${escapeHtml(b.author)}</p></div>
            <div>
              <a href="/marked/${b.key}" class="action-btn" style="margin-right:5px">View</a>
              <a href="/marked/${b.key}/download" class="action-btn">Download</a>
              <button onclick="deleteMarkedBook('${b.key}')" class="action-btn danger" style="margin-left:5px">Delete</button>
            </div>
          </div>`).join('')}`;
        return res.status(200).send(htmlPage('Marked Text Exports', content));
      }

      if (path.startsWith('/marked/') && path.endsWith('/download')) {
        const bookKey = path.replace('/marked/', '').replace('/download', '');
        const book = await safeGet(`marked_book:${bookKey}`);
        if (!book) return res.status(404).send('Not found');
        const safeFilename = (book.title || 'marked_export').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'marked_export';
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.md"`);
        return res.status(200).send(book.content);
      }

      if (path.startsWith('/marked/')) {
        const bookKey = path.replace('/marked/', '');
        const book = await safeGet(`marked_book:${bookKey}`);
        if (!book) return res.status(404).send('Not found');
        const content = `<h1>${escapeHtml(book.title)}</h1>
          <p style="color:#666">${escapeHtml(book.author)}</p>
          <div style="margin:20px 0">
            <a href="/marked/${bookKey}/download" class="action-btn">Download Markdown</a>
            <button onclick="deleteMarkedBook('${bookKey}')" class="action-btn danger">Delete</button>
          </div>
          <div style="background:white;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);white-space:pre-wrap;font-family:Georgia,serif;line-height:1.8">${escapeHtml(book.content)}</div>`;
        return res.status(200).send(htmlPage(book.title, content));
      }

      if (path === '/export/all') {
        const format = url.searchParams.get('format') || 'md';
        const allIds = await safeGetArray('all_highlights');
        const highlights = [];
        for (const id of allIds) {
          const h = await safeGet(`highlight:${id}`);
          if (h) highlights.push(h);
        }
        if (format === 'json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', 'attachment; filename=highlights.json');
          return res.status(200).send(JSON.stringify(highlights, null, 2));
        }
        let md = '# My Highlights\n\n';
        for (const h of highlights) { md += `## ${h.author} - ${h.title}\n\n> ${h.text}\n\n`; }
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', 'attachment; filename=highlights.md');
        return res.status(200).send(md);
      }

      if (path.startsWith('/export/book/')) {
        const bookKey = path.replace('/export/book/', '');
        const format = url.searchParams.get('format') || 'md';
        const book = await safeGet(`book:${bookKey}`);
        if (!book) return res.status(404).send('Book not found');
        const ids = await safeGetArray(`book_highlights:${bookKey}`);
        const highlights = [];
        for (const id of ids) {
          const h = await safeGet(`highlight:${id}`);
          if (h) highlights.push(h);
        }
        if (format === 'json') {
          res.setHeader('Content-Type', 'application/json');
          const safeFilenameJson = (book.title || 'export').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'export';
          res.setHeader('Content-Disposition', `attachment; filename="${safeFilenameJson}.json"`);
          return res.status(200).send(JSON.stringify({ book, highlights }, null, 2));
        }
        let md = `# ${book.author} - ${book.title}\n\n`;
        highlights.forEach((h, i) => {
          md += `## Entry ${i + 1}\n\n${h.text}\n\n`;
        });
        const safeFilename = (book.title || 'export').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'export';
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.md"`);
        return res.status(200).send(md);
      }

      if (path.startsWith('/book/')) {
        const bookKey = path.replace('/book/', '');
        const book = await safeGet(`book:${bookKey}`);
        if (!book) return res.status(404).send('Book not found');
        const ids = await safeGetArray(`book_highlights:${bookKey}`);
        const highlights = [];
        for (const id of ids) {
          const h = await safeGet(`highlight:${id}`);
          if (h) highlights.push(h);
        }
        const content = `<h1>${escapeHtml(book.title)}</h1><p style="color:#666">${escapeHtml(book.author)}</p><p>${highlights.length} highlights</p>
          <div style="margin:20px 0">
            <a href="/export/book/${bookKey}?format=md" class="action-btn">Export Markdown</a>
            <a href="/export/book/${bookKey}?format=json" class="action-btn">Export JSON</a>
            <button onclick="deleteBook('${bookKey}')" class="action-btn danger">Delete Book</button>
          </div>
          ${highlights.map(h => `<div class="highlight">
            <div class="highlight-actions"><button class="delete-btn" onclick="deleteHighlight('${h.id}', '${bookKey}')">Delete</button></div>
            <div class="highlight-text">"${escapeHtml(h.text)}"</div>
            ${h.chapter ? `<div class="highlight-meta">${escapeHtml(h.chapter)}</div>` : ''}
          </div>`).join('')}`;
        return res.status(200).send(htmlPage(book.title, content));
      }
    }

    return res.status(404).send('Not found');
  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: 'Server error', details: e.message });
  }
}
