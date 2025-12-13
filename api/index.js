import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();

// Set your secret code as environment variable SECRET_CODE in Vercel dashboard
const SECRET_CODE = process.env.SECRET_CODE || 'CHANGE_ME';

// Generate a simple ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Normalize author/title for consistent keys
function normalizeKey(str) {
  return str.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Escape HTML
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape CSV
function escapeCsv(str) {
  return str.replace(/"/g, '""');
}

// HTML template
function htmlPage(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Highlights</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #fafafa;
      color: #333;
      line-height: 1.6;
    }
    h1 { color: #222; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
    h2 { color: #444; margin-top: 30px; }
    h3 { color: #555; margin-top: 20px; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .highlight {
      background: white;
      border-left: 4px solid #0066cc;
      padding: 15px 20px;
      margin: 15px 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .highlight-text {
      font-style: italic;
      font-size: 1.1em;
      color: #333;
    }
    .highlight-meta {
      font-size: 0.85em;
      color: #888;
      margin-top: 10px;
    }
    .book-card {
      background: white;
      padding: 15px 20px;
      margin: 10px 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .book-info h3 { margin: 0 0 5px 0; }
    .book-info p { margin: 0; color: #666; }
    .book-count {
      background: #0066cc;
      color: white;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 0.9em;
    }
    .nav {
      background: #333;
      padding: 10px 20px;
      margin: -20px -20px 20px -20px;
    }
    .nav a {
      color: white;
      margin-right: 20px;
    }
    .search-box {
      width: 100%;
      padding: 12px;
      font-size: 16px;
      border: 1px solid #ddd;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .export-links {
      background: #f0f0f0;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
    }
    .export-links a {
      margin-right: 15px;
      padding: 8px 15px;
      background: #0066cc;
      color: white;
      border-radius: 4px;
    }
    .export-links a:hover {
      background: #0055aa;
      text-decoration: none;
    }
    .chapter { 
      color: #666; 
      font-size: 0.9em;
      margin-bottom: 5px;
    }
    .stats {
      display: flex;
      gap: 30px;
      margin: 20px 0;
    }
    .stat {
      background: white;
      padding: 15px 25px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .stat-number { font-size: 2em; font-weight: bold; color: #0066cc; }
    .stat-label { color: #666; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/">Home</a>
    <a href="/books">Books</a>
    <a href="/search">Search</a>
    <a href="/export">Export</a>
  </nav>
  ${content}
</body>
</html>`;
}

// API: Add highlight
async function addHighlight(body) {
  const { code, text, title, author, chapter } = body;

  if (!code || code.toUpperCase() !== SECRET_CODE.toUpperCase()) {
    return new Response(JSON.stringify({ error: 'Invalid code' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!text || !title || !author) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = generateId();
  const highlight = {
    id,
    text: text.trim(),
    title: title.trim(),
    author: author.trim(),
    chapter: chapter?.trim() || undefined,
    created_at: new Date().toISOString(),
  };

  const bookKey = normalizeKey(`${author}_${title}`);

  // Save highlight
  await kv.set(`highlight:${id}`, highlight);
  
  // Add to book's highlight list
  const bookHighlights = await kv.get(`book_highlights:${bookKey}`) || [];
  bookHighlights.push(id);
  await kv.set(`book_highlights:${bookKey}`, bookHighlights);

  // Update book metadata
  const book = await kv.get(`book:${bookKey}`) || {
    title: title.trim(),
    author: author.trim(),
    highlight_count: 0,
    last_updated: '',
  };
  book.highlight_count += 1;
  book.last_updated = highlight.created_at;
  await kv.set(`book:${bookKey}`, book);

  // Add to book list if new
  const books = await kv.get('books') || [];
  if (!books.includes(bookKey)) {
    books.push(bookKey);
    await kv.set('books', books);
  }

  // Add to all highlights list
  const allHighlights = await kv.get('all_highlights') || [];
  allHighlights.unshift(id); // Add to front (newest first)
  await kv.set('all_highlights', allHighlights);

  return new Response(JSON.stringify({ success: true, id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// API: Bulk add highlights
async function addBulkHighlights(body) {
  const { code, title, author, bookmarks } = body;

  if (!code || code.toUpperCase() !== SECRET_CODE.toUpperCase()) {
    return new Response(JSON.stringify({ error: 'Invalid code' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!title || !author || !bookmarks || !Array.isArray(bookmarks)) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const bookKey = normalizeKey(`${author}_${title}`);
  let addedCount = 0;

  const bookHighlights = await kv.get(`book_highlights:${bookKey}`) || [];
  const allHighlights = await kv.get('all_highlights') || [];

  for (const bookmark of bookmarks) {
    const text = bookmark.text_orig || bookmark.text || bookmark;
    if (!text || typeof text !== 'string') continue;

    const id = generateId();
    const highlight = {
      id,
      text: text.trim(),
      title: title.trim(),
      author: author.trim(),
      created_at: new Date().toISOString(),
    };

    await kv.set(`highlight:${id}`, highlight);
    bookHighlights.push(id);
    allHighlights.unshift(id);
    addedCount++;
  }

  await kv.set(`book_highlights:${bookKey}`, bookHighlights);
  await kv.set('all_highlights', allHighlights);

  // Update book metadata
  const book = await kv.get(`book:${bookKey}`) || {
    title: title.trim(),
    author: author.trim(),
    highlight_count: 0,
    last_updated: '',
  };
  book.highlight_count += addedCount;
  book.last_updated = new Date().toISOString();
  await kv.set(`book:${bookKey}`, book);

  // Add to book list if new
  const books = await kv.get('books') || [];
  if (!books.includes(bookKey)) {
    books.push(bookKey);
    await kv.set('books', books);
  }

  return new Response(JSON.stringify({ success: true, added: addedCount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Get all highlights
async function getAllHighlights() {
  const ids = await kv.get('all_highlights') || [];
  const highlights = [];
  for (const id of ids) {
    const h = await kv.get(`highlight:${id}`);
    if (h) highlights.push(h);
  }
  return highlights;
}

// Get all books
async function getAllBooks() {
  const bookKeys = await kv.get('books') || [];
  const books = [];
  for (const key of bookKeys) {
    const b = await kv.get(`book:${key}`);
    if (b) books.push({ ...b, key });
  }
  return books.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
}

// Get highlights for a book
async function getBookHighlights(bookKey) {
  const ids = await kv.get(`book_highlights:${bookKey}`) || [];
  const highlights = [];
  for (const id of ids) {
    const h = await kv.get(`highlight:${id}`);
    if (h) highlights.push(h);
  }
  return highlights;
}

// Search highlights
async function searchHighlights(query) {
  const highlights = await getAllHighlights();
  const q = query.toLowerCase();
  return highlights.filter(h =>
    h.text.toLowerCase().includes(q) ||
    h.title.toLowerCase().includes(q) ||
    h.author.toLowerCase().includes(q)
  );
}

// Page: Home
async function homePage() {
  const highlights = await getAllHighlights();
  const books = await getAllBooks();
  const recent = highlights.slice(0, 10);

  const content = `
    <h1>📚 My Highlights</h1>
    
    <div class="stats">
      <div class="stat">
        <div class="stat-number">${highlights.length}</div>
        <div class="stat-label">Highlights</div>
      </div>
      <div class="stat">
        <div class="stat-number">${books.length}</div>
        <div class="stat-label">Books</div>
      </div>
    </div>

    <h2>Recent Highlights</h2>
    ${recent.map(h => `
      <div class="highlight">
        <div class="highlight-text">"${escapeHtml(h.text)}"</div>
        <div class="highlight-meta">
          <strong>${escapeHtml(h.author)}</strong> — ${escapeHtml(h.title)}
          ${h.chapter ? `<br>Chapter: ${escapeHtml(h.chapter)}` : ''}
        </div>
      </div>
    `).join('')}
    
    ${highlights.length > 10 ? `<p><a href="/all">View all ${highlights.length} highlights →</a></p>` : ''}
  `;

  return new Response(htmlPage('Home', content), {
    headers: { 'Content-Type': 'text/html' },
  });
}

// Page: All highlights
async function allHighlightsPage() {
  const highlights = await getAllHighlights();

  const content = `
    <h1>All Highlights (${highlights.length})</h1>
    
    ${highlights.map(h => `
      <div class="highlight">
        <div class="highlight-text">"${escapeHtml(h.text)}"</div>
        <div class="highlight-meta">
          <strong>${escapeHtml(h.author)}</strong> — ${escapeHtml(h.title)}
          ${h.chapter ? `<br>Chapter: ${escapeHtml(h.chapter)}` : ''}
        </div>
      </div>
    `).join('')}
  `;

  return new Response(htmlPage('All Highlights', content), {
    headers: { 'Content-Type': 'text/html' },
  });
}

// Page: Books
async function booksPage() {
  const books = await getAllBooks();

  const content = `
    <h1>📖 Books (${books.length})</h1>
    
    ${books.map(b => `
      <a href="/book/${b.key}" style="text-decoration: none; color: inherit;">
        <div class="book-card">
          <div class="book-info">
            <h3>${escapeHtml(b.title)}</h3>
            <p>${escapeHtml(b.author)}</p>
          </div>
          <div class="book-count">${b.highlight_count}</div>
        </div>
      </a>
    `).join('')}
  `;

  return new Response(htmlPage('Books', content), {
    headers: { 'Content-Type': 'text/html' },
  });
}

// Page: Single book
async function bookPage(bookKey) {
  const book = await kv.get(`book:${bookKey}`);
  if (!book) {
    return new Response('Book not found', { status: 404 });
  }

  const highlights = await getBookHighlights(bookKey);

  // Group by chapter
  const byChapter = new Map();
  for (const h of highlights) {
    const chapter = h.chapter || '(No chapter)';
    if (!byChapter.has(chapter)) {
      byChapter.set(chapter, []);
    }
    byChapter.get(chapter).push(h);
  }

  let highlightsHtml = '';
  for (const [chapter, chapterHighlights] of byChapter) {
    if (chapter !== '(No chapter)') {
      highlightsHtml += `<h3 class="chapter">${escapeHtml(chapter)}</h3>`;
    }
    highlightsHtml += chapterHighlights.map(h => `
      <div class="highlight">
        <div class="highlight-text">"${escapeHtml(h.text)}"</div>
      </div>
    `).join('');
  }

  const content = `
    <h1>${escapeHtml(book.title)}</h1>
    <p style="color: #666; font-size: 1.1em;">${escapeHtml(book.author)}</p>
    <p>${highlights.length} highlights</p>
    
    <div class="export-links">
      <a href="/export/book/${bookKey}?format=md">Export Markdown</a>
      <a href="/export/book/${bookKey}?format=json">Export JSON</a>
    </div>
    
    ${highlightsHtml}
  `;

  return new Response(htmlPage(book.title, content), {
    headers: { 'Content-Type': 'text/html' },
  });
}

// Page: Search
async function searchPage(query) {
  let resultsHtml = '';

  if (query) {
    const results = await searchHighlights(query);
    resultsHtml = `
      <p>${results.length} results for "${escapeHtml(query)}"</p>
      ${results.map(h => `
        <div class="highlight">
          <div class="highlight-text">"${escapeHtml(h.text)}"</div>
          <div class="highlight-meta">
            <strong>${escapeHtml(h.author)}</strong> — ${escapeHtml(h.title)}
          </div>
        </div>
      `).join('')}
    `;
  }

  const content = `
    <h1>🔍 Search</h1>
    <form method="GET" action="/search">
      <input type="text" name="q" class="search-box" placeholder="Search highlights, books, authors..." value="${escapeHtml(query || '')}">
    </form>
    ${resultsHtml}
  `;

  return new Response(htmlPage('Search', content), {
    headers: { 'Content-Type': 'text/html' },
  });
}

// Page: Export
async function exportPage() {
  const content = `
    <h1>📤 Export</h1>
    
    <h2>All Highlights</h2>
    <div class="export-links">
      <a href="/export/all?format=md">Markdown</a>
      <a href="/export/all?format=json">JSON</a>
      <a href="/export/all?format=csv">CSV</a>
    </div>
    
    <h2>By Book</h2>
    <p>Visit a <a href="/books">book's page</a> to export just that book's highlights.</p>
  `;

  return new Response(htmlPage('Export', content), {
    headers: { 'Content-Type': 'text/html' },
  });
}

// Export: All
async function exportAll(format) {
  const highlights = await getAllHighlights();

  if (format === 'json') {
    return new Response(JSON.stringify(highlights, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename=highlights.json',
      },
    });
  }

  if (format === 'csv') {
    const csv = [
      'Author,Title,Chapter,Text,Date',
      ...highlights.map(h =>
        `"${escapeCsv(h.author)}","${escapeCsv(h.title)}","${escapeCsv(h.chapter || '')}","${escapeCsv(h.text)}","${h.created_at}"`
      ),
    ].join('\n');

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=highlights.csv',
      },
    });
  }

  // Markdown (default)
  const byAuthor = new Map();
  for (const h of highlights) {
    if (!byAuthor.has(h.author)) {
      byAuthor.set(h.author, new Map());
    }
    const authorBooks = byAuthor.get(h.author);
    if (!authorBooks.has(h.title)) {
      authorBooks.set(h.title, []);
    }
    authorBooks.get(h.title).push(h);
  }

  let md = '# My Highlights\n\n';
  const sortedAuthors = [...byAuthor.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  
  for (const [author, books] of sortedAuthors) {
    const sortedBooks = [...books.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    
    for (const [title, bookHighlights] of sortedBooks) {
      md += `## ${author} - ${title}\n\n`;

      const byChapter = new Map();
      for (const h of bookHighlights) {
        const chapter = h.chapter || '';
        if (!byChapter.has(chapter)) {
          byChapter.set(chapter, []);
        }
        byChapter.get(chapter).push(h);
      }

      for (const [chapter, chapterHighlights] of byChapter) {
        if (chapter) {
          md += `### ${chapter}\n\n`;
        }
        for (const h of chapterHighlights) {
          md += `> ${h.text}\n\n`;
        }
      }
    }
  }

  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': 'attachment; filename=highlights.md',
    },
  });
}

// Export: Single book
async function exportBook(bookKey, format) {
  const book = await kv.get(`book:${bookKey}`);
  if (!book) {
    return new Response('Book not found', { status: 404 });
  }

  const highlights = await getBookHighlights(bookKey);

  if (format === 'json') {
    return new Response(JSON.stringify({ book, highlights }, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${book.title}.json"`,
      },
    });
  }

  // Markdown
  let md = `# ${book.author} - ${book.title}\n\n`;

  const byChapter = new Map();
  for (const h of highlights) {
    const chapter = h.chapter || '';
    if (!byChapter.has(chapter)) {
      byChapter.set(chapter, []);
    }
    byChapter.get(chapter).push(h);
  }

  for (const [chapter, chapterHighlights] of byChapter) {
    if (chapter) {
      md += `## ${chapter}\n\n`;
    }
    for (const h of chapterHighlights) {
      md += `> ${h.text}\n\n`;
    }
  }

  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="${book.title}.md"`,
    },
  });
}

// Main handler
export default async function handler(req) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const path = url.pathname;

  try {
    // API endpoints
    if (req.method === 'POST' && path === '/create') {
      const body = await req.json();
      return addHighlight(body);
    }
    if (req.method === 'POST' && path === '/bulk_create') {
      const body = await req.json();
      return addBulkHighlights(body);
    }

    // Web pages
    if (req.method === 'GET') {
      if (path === '/' || path === '') {
        return homePage();
      }
      if (path === '/all') {
        return allHighlightsPage();
      }
      if (path === '/books') {
        return booksPage();
      }
      if (path.startsWith('/book/')) {
        const bookKey = path.replace('/book/', '');
        return bookPage(bookKey);
      }
      if (path === '/search') {
        const query = url.searchParams.get('q') || undefined;
        return searchPage(query);
      }
      if (path === '/export') {
        return exportPage();
      }
      if (path === '/export/all') {
        const format = url.searchParams.get('format') || 'md';
        return exportAll(format);
      }
      if (path.startsWith('/export/book/')) {
        const bookKey = path.replace('/export/book/', '');
        const format = url.searchParams.get('format') || 'md';
        return exportBook(bookKey, format);
      }
    }

    return new Response('Not found', { status: 404 });
  } catch (e) {
    console.error('Error:', e);
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
