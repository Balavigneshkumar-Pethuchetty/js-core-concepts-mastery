#!/usr/bin/env node
'use strict';
// Converts every day-XX/README.md into a styled, standalone day-XX/guide.html
// so READMEs are readable straight from the file:// menu instead of as raw
// markdown text. No dependencies — rerun after editing any README.md:
//   node scripts/build-guides.js

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Minimal markdown -> HTML renderer (headings, bold/italic, inline code,
// fenced code blocks, lists incl. one level of nesting, tables, blockquotes,
// links, hr, paragraphs). Covers exactly what this course's READMEs use.
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function inline(text) {
  const codeSpans = [];
  text = text.replace(/`([^`]+)`/g, (_, p1) => {
    codeSpans.push(escapeHtml(p1));
    return `\u0000C${codeSpans.length - 1}\u0000`;
  });
  const links = [];
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
    links.push([t, u]);
    return `\u0000L${links.length - 1}\u0000`;
  });
  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\u0000L(\d+)\u0000/g, (_, i) => {
    const [t, u] = links[i];
    return `<a href="${escapeAttr(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t)}</a>`;
  });
  text = text.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${codeSpans[i]}</code>`);
  return text;
}

function isBlockStart(line) {
  return (
    /^```/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\|.*\|\s*$/.test(line) ||
    /^\s*([-*+]|\d+\.)\s+/.test(line)
  );
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function parseList(lines, start) {
  const first = lines[start].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
  const baseIndent = first[1].length;
  const isOrdered = /\d+\./.test(first[2]);
  const tag = isOrdered ? 'ol' : 'ul';
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!m) break;
    const indent = m[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      const nested = parseList(lines, i);
      if (items.length) items[items.length - 1] += nested.listHtml;
      i = nested.nextIndex;
      continue;
    }
    items.push(inline(m[3]));
    i++;
  }
  const listHtml = `<${tag}>${items.map((it) => `<li>${it}</li>`).join('')}</${tag}>`;
  return { listHtml, nextIndex: i };
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre class="code-block"><code class="lang-${lang}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote><p>${inline(q.join(' '))}</p></blockquote>`);
      continue;
    }

    if (
      /^\|.*\|\s*$/.test(line) &&
      lines[i + 1] &&
      /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])
    ) {
      const headerCells = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headerCells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const { listHtml, nextIndex } = parseList(lines, i);
      out.push(listHtml);
      i = nextIndex;
      continue;
    }

    const paraLines = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(paraLines.join(' ').trim())}</p>`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

function wrapPage({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --border:#30363d; --text:#c9d1d9; --muted:#8b949e; --accent:#58a6ff; --accent-dim:#1f6feb; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; line-height:1.65; }
  .topbar { position:sticky; top:0; background:var(--panel); border-bottom:1px solid var(--border); padding:0.8rem 1.5rem; display:flex; gap:1.25rem; align-items:center; z-index:10; }
  .topbar a { color:var(--accent); text-decoration:none; font-size:0.85rem; font-family:ui-monospace,Consolas,monospace; }
  .topbar a:hover { text-decoration:underline; }
  .topbar .spacer { flex:1; }
  main { max-width:820px; margin:0 auto; padding:2.5rem 1.5rem 5rem; }
  h1,h2,h3,h4 { color:#e6edf3; line-height:1.3; }
  h1 { font-size:1.7rem; border-bottom:1px solid var(--border); padding-bottom:0.6rem; margin-top:0; }
  h2 { font-size:1.3rem; margin-top:2.2rem; }
  h3 { font-size:1.08rem; color:var(--accent); margin-top:1.6rem; }
  p { color:var(--text); font-size:0.98rem; }
  strong { color:#f0f6fc; }
  em { color:#d2a8ff; font-style:italic; }
  a { color:var(--accent); }
  code { font-family:ui-monospace,Consolas,"SF Mono",monospace; background:#1f242c; color:#ffa657; padding:0.1rem 0.35rem; border-radius:4px; font-size:0.87em; }
  pre.code-block { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:1rem 1.1rem; overflow-x:auto; margin:1rem 0; }
  pre.code-block code { background:none; color:#c9d1d9; padding:0; font-size:0.85rem; line-height:1.55; }
  ul, ol { padding-left:1.4rem; color:var(--text); font-size:0.97rem; }
  li { margin:0.3rem 0; }
  li ul, li ol { margin-top:0.3rem; }
  blockquote { border-left:3px solid var(--accent-dim); margin:1rem 0; padding:0.3rem 1rem; background:var(--panel); border-radius:0 6px 6px 0; color:var(--muted); }
  blockquote p { margin:0; color:var(--muted); }
  hr { border:none; border-top:1px solid var(--border); margin:2rem 0; }
  .table-wrap { overflow-x:auto; margin:1.2rem 0; }
  table { border-collapse:collapse; width:100%; font-size:0.9rem; }
  th, td { border:1px solid var(--border); padding:0.5rem 0.75rem; text-align:left; vertical-align:top; }
  th { background:var(--panel); color:#e6edf3; }
  tr:nth-child(even) td { background:#11161d; }
</style>
</head>
<body>
  <div class="topbar">
    <a href="../index.html">&larr; All Days</a>
    <span class="spacer"></span>
    <a href="index.html">&#9654; Open Sandbox</a>
  </div>
  <main>
${bodyHtml}
  </main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const root = path.basename(__dirname) === 'scripts' ? path.join(__dirname, '..') : __dirname;
const dayDirs = fs
  .readdirSync(root)
  .filter((d) => /^day-\d{2}-/.test(d) && fs.statSync(path.join(root, d)).isDirectory())
  .sort();

let built = 0;
for (const dir of dayDirs) {
  const readmePath = path.join(root, dir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    console.warn(`skip ${dir}: no README.md found`);
    continue;
  }
  const md = fs.readFileSync(readmePath, 'utf8');
  const bodyHtml = renderMarkdown(md);
  const titleMatch = md.match(/^#\s+(.*)$/m);
  const title = titleMatch ? titleMatch[1].trim() : dir;
  fs.writeFileSync(path.join(root, dir, 'guide.html'), wrapPage({ title, bodyHtml }), 'utf8');
  built++;
}
console.log(`Built ${built} guide.html page(s) from README.md files.`);
