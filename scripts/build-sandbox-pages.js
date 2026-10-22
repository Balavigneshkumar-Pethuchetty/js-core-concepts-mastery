#!/usr/bin/env node
'use strict';
// Builds every day-XX/index.html sandbox from day-XX/script.js, splitting the
// script into its labeled "// ===... // TITLE // ===..." banner sections and
// rendering each section's CODE directly above the LIVE OUTPUT it produces,
// so a reader can correlate "this code" with "this result" instead of
// reading a blind, flat console dump. The script's own inline comments (the
// course was explicitly authored with heavy "why, not what" comments) serve
// as the in-place explanation for each block.
//
// Correctness note: async callbacks (setTimeout/.then/queueMicrotask/rAF)
// are patched at runtime to remember which section SCHEDULED them, so a
// setTimeout registered in Section 2 still reports its output under Section
// 2 even if it actually fires after Section 4 has already run — this is
// essential for the Day 15-22 async-ordering material, where output order
// legitimately differs from source order.
//
//   node scripts/build-sandbox-pages.js

const fs = require('fs');
const path = require('path');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Parse script.js into: an intro (first banner's text) + an ordered list of
// sections, each with a title, optional description, and its source code.
// Also returns enough position info to build an instrumented copy for
// execution, with zero changes to formatting other than inserted markers.
// ---------------------------------------------------------------------------

function isBorderLine(line) {
  return /^\s*\/\/\s*={10,}\s*$/.test(line);
}
function isCommentLine(line) {
  return /^\s*\/\/.*$/.test(line);
}

function findBanners(lines) {
  const banners = [];
  let i = 0;
  while (i < lines.length) {
    if (isBorderLine(lines[i])) {
      const startLine = i;
      let j = i + 1;
      const body = [];
      while (j < lines.length && !isBorderLine(lines[j]) && isCommentLine(lines[j])) {
        body.push(lines[j].replace(/^\s*\/\/\s?/, ''));
        j++;
      }
      if (j < lines.length && isBorderLine(lines[j])) {
        banners.push({ startLine, endLine: j, body });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return banners;
}

function parseScript(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const banners = findBanners(lines);

  if (banners.length === 0) {
    return {
      intro: null,
      sections: [{ index: 1, title: 'Script', description: '', code: source.trim() }],
      lines,
      banners: [],
    };
  }

  const raw = banners.map((banner, b) => {
    const codeStart = banner.endLine + 1;
    const codeEnd = b + 1 < banners.length ? banners[b + 1].startLine : lines.length;
    const code = lines.slice(codeStart, codeEnd).join('\n').trim();
    const nonEmpty = banner.body.map((l) => l.trim()).filter(Boolean);
    return { title: nonEmpty[0] || `Part ${b + 1}`, description: nonEmpty.slice(1).join(' '), code };
  });

  if (raw.length === 1) {
    return { intro: null, sections: [{ index: 1, ...raw[0] }], lines, banners };
  }

  const intro = { title: raw[0].title, description: raw[0].description };
  const rest = raw.slice(1);
  if (raw[0].code) {
    rest[0].code = raw[0].code + (rest[0].code ? '\n\n' + rest[0].code : '');
  }
  const sections = rest.map((s, idx) => ({ index: idx + 1, title: s.title, description: s.description, code: s.code }));
  return { intro, sections, lines, banners };
}

// Reconstruct the ORIGINAL source, byte-for-byte, with:
//  (a) one `__jsSection(N);` statement right after each real section's
//      closing banner border, so code that runs directly at a section's top
//      level (not inside any function) is attributed correctly; and
//  (b) a `var console = __sectionConsole(N);` statement as literally the
//      FIRST line inside every top-level (column-0) function declaration
//      found within section N's code.
//
// (b) deliberately uses lexical shadowing rather than wrapping the function
// call itself. A wrap-the-call approach (set a global "current section" on
// entry, restore on exit) looks right but silently breaks for native
// async/await: V8's internal continuation scheduling after an `await` does
// NOT route through the user-overridable Promise.prototype.then (verified
// empirically — patching .then never fires for await's own suspension), so
// anything logged after an `await` would get mis-attributed to whatever
// happened to be "current" by the time that continuation actually runs.
// Shadowing `console` locally sidesteps this entirely: it's just an ordinary
// closure variable, and closures — including everything written after an
// `await`, since it's still the same function body/scope — correctly keep
// referencing that same local binding no matter how the engine schedules
// the resumption. This also means a function DEFINED in section N but
// CALLED later from a completely different section (e.g. Day 22, where
// puzzle1..puzzle4 are each defined in their own section but all invoked
// together from one "run everything" section at the bottom) still
// correctly attributes its own output back to N, and any further nested
// helper function declared inside it inherits the same shadowed console via
// normal scope-chain lookup, with no extra handling needed.
//
// Never inserts anything before the file's first line, so a leading
// 'use strict' directive stays intact as the literal first statement.
function buildInstrumented(lines, banners) {
  if (banners.length < 2) return lines.join('\n'); // nothing meaningful to tag

  // Map every line index to the section it belongs to. 0 means "pre-section-1
  // preamble" (shared helpers like a `printHeader`-style utility used by
  // several later sections) — bundled into section 1's CODE DISPLAY for
  // reading, but deliberately left untouched for EXECUTION, so calling such
  // a helper from inside section 3's code correctly stays attributed to
  // section 3 (the actual caller, whose own shadowed console is what's in
  // scope at the call site), instead of hijacking it back to section 1.
  const lineSection = new Array(lines.length).fill(0);
  for (let b = 1; b < banners.length; b++) {
    const start = banners[b].endLine + 1;
    const end = b + 1 < banners.length ? banners[b + 1].startLine : lines.length;
    for (let ln = start; ln < end; ln++) lineSection[ln] = b;
  }

  // Find top-level (zero-indentation) function declarations. Every file in
  // this course uses consistent indentation, so column-0 reliably marks a
  // declaration that belongs directly to its enclosing section (as opposed
  // to a nested helper declared inside another function, which inherits its
  // section automatically via the scope chain and needs no insertion here).
  //
  // Two insertions per such function, working together:
  //   1. A shadowed `console` as its first body line — robust across
  //      `await`, covers everything the function itself directly logs.
  //   2. A call-boundary wrap of the function reference itself, updating the
  //      GLOBAL current-section fallback for the duration of its
  //      synchronous call — covers the case where it calls some OTHER,
  //      preamble-defined shared helper (like a `printHeader`-style
  //      utility), which has no shadowed console of its own and so falls
  //      back to reading that global.
  const fnDeclRe = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(.*\{\s*$/;
  const shadowInsertions = new Map(); // line index -> text to insert right after it
  const wraps = []; // { afterLine, name, section }
  for (let ln = 0; ln < lines.length; ln++) {
    const m = lines[ln].match(fnDeclRe);
    if (!m) continue;
    if (lineSection[ln] === 0) continue; // preamble helper — stays transparent, no instrumentation
    shadowInsertions.set(ln, `  var console = __sectionConsole(${lineSection[ln]});`);

    let closeLine = -1;
    for (let k = ln + 1; k < lines.length; k++) {
      if (lines[k] === '}' || lines[k].trimEnd() === '}') {
        closeLine = k;
        break;
      }
    }
    if (closeLine !== -1) wraps.push({ afterLine: closeLine, name: m[1], section: lineSection[ln] });
  }
  const wrapsByLine = new Map();
  for (const w of wraps) {
    if (!wrapsByLine.has(w.afterLine)) wrapsByLine.set(w.afterLine, []);
    wrapsByLine.get(w.afterLine).push(w);
  }

  const out = [];
  let bannerPtr = 0;
  for (let ln = 0; ln < lines.length; ln++) {
    out.push(lines[ln]);
    if (shadowInsertions.has(ln)) out.push(shadowInsertions.get(ln));
    if (wrapsByLine.has(ln)) {
      for (const w of wrapsByLine.get(ln)) {
        out.push(`try { ${w.name} = __wrapSection(${w.section}, ${w.name}); } catch (e) {}`);
      }
    }
    if (bannerPtr < banners.length && ln === banners[bannerPtr].endLine) {
      if (bannerPtr >= 1) out.push(`__jsSection(${bannerPtr});`);
      bannerPtr++;
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Page template
// ---------------------------------------------------------------------------

function sectionCard(section) {
  return `
    <section class="demo-section">
      <h2>Section ${section.index} &mdash; ${escapeHtml(section.title)}</h2>
      ${section.description ? `<p class="section-desc">${escapeHtml(section.description)}</p>` : ''}
      <pre class="code-block"><code>${escapeHtml(section.code)}</code></pre>
      <div class="output-label">Live output</div>
      <div class="section-output" id="output-${section.index}"></div>
    </section>`;
}

function page({ title, introTitle, introDescription, sections, instrumentedSource }) {
  const safeTitle = escapeHtml(title);
  // Avoid the embedded source prematurely closing the real <script> tag.
  const embedded = JSON.stringify(instrumentedSource).replace(/<\/script/gi, '<\\/script');
  const sectionsHtml = sections.map(sectionCard).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <script>
    (function () {
      try {
        var stored = localStorage.getItem('jscore-theme');
        if (stored) document.documentElement.setAttribute('data-theme', stored);
      } catch (e) {}
    })();
  </script>
  <style>
    :root {
      --bg:#0d1117; --panel:#161b22; --border:#30363d; --text:#c9d1d9; --heading:#e6edf3;
      --muted:#8b949e; --accent:#58a6ff; --accent-dim:#1f6feb; --code-bg:#1f242c; --code-text:#ffa657;
      --err:#ff7b72; --err-bg:#2d1618;
    }
    @media (prefers-color-scheme: light) {
      :root:not([data-theme="dark"]) {
        --bg:#ffffff; --panel:#f6f8fa; --border:#d0d7de; --text:#24292f; --heading:#1f2328;
        --muted:#57606a; --accent:#0969da; --accent-dim:#0550ae; --code-bg:#eef1f4; --code-text:#953800;
        --err:#cf222e; --err-bg:#fff0ef;
      }
    }
    :root[data-theme="light"] {
      --bg:#ffffff; --panel:#f6f8fa; --border:#d0d7de; --text:#24292f; --heading:#1f2328;
      --muted:#57606a; --accent:#0969da; --accent-dim:#0550ae; --code-bg:#eef1f4; --code-text:#953800;
      --err:#cf222e; --err-bg:#fff0ef;
    }
    :root[data-theme="dark"] {
      --bg:#0d1117; --panel:#161b22; --border:#30363d; --text:#c9d1d9; --heading:#e6edf3;
      --muted:#8b949e; --accent:#58a6ff; --accent-dim:#1f6feb; --code-bg:#1f242c; --code-text:#ffa657;
      --err:#ff7b72; --err-bg:#2d1618;
    }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; line-height:1.6; transition:background 0.15s ease, color 0.15s ease; }
    .topbar { position:sticky; top:0; background:var(--panel); border-bottom:1px solid var(--border); padding:0.8rem 1.5rem; display:flex; gap:1.25rem; align-items:center; z-index:10; }
    .topbar a { color:var(--accent); text-decoration:none; font-size:0.85rem; font-family:ui-monospace,Consolas,monospace; }
    .topbar a:hover { text-decoration:underline; }
    .topbar .spacer { flex:1; }
    .theme-toggle { width:1.9rem; height:1.9rem; border-radius:50%; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:0.95rem; cursor:pointer; display:flex; align-items:center; justify-content:center; }
    .theme-toggle:hover { border-color:var(--accent); }
    main { max-width:880px; margin:0 auto; padding:2rem 1.5rem 5rem; }
    h1 { color:var(--heading); font-size:1.5rem; border-bottom:1px solid var(--border); padding-bottom:0.6rem; }
    .intro-desc { color:var(--muted); font-size:0.95rem; margin-top:-0.5rem; }
    h2 { color:var(--accent); font-size:1.1rem; margin:0 0 0.4rem; }
    .section-desc { color:var(--muted); font-size:0.9rem; margin:0 0 0.8rem; }
    .demo-section { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:1.2rem 1.3rem; margin-bottom:1.3rem; }
    pre.code-block { background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:0.9rem 1rem; overflow-x:auto; margin:0 0 0.9rem; }
    pre.code-block code { font-family:ui-monospace,Consolas,"SF Mono",monospace; color:var(--text); font-size:0.82rem; line-height:1.55; background:none; }
    .output-label { font-size:0.72rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); margin-bottom:0.35rem; }
    .section-output { background:var(--code-bg); border:1px solid var(--border); border-radius:6px; padding:0.7rem 0.9rem; min-height:1.6rem; font-family:ui-monospace,Consolas,monospace; font-size:0.85rem; white-space:pre-wrap; }
    .log-line { border-bottom:1px dashed var(--border); padding:2px 0; color:var(--code-text); }
    .log-line:last-child { border-bottom:none; }
    .log-line.log-error { color:var(--err); }
    .log-line.log-muted { color:var(--muted); font-style:italic; border-bottom:none; }
  </style>
</head>
<body>
  <button class="theme-toggle" id="themeToggle" title="Toggle light / dark theme" aria-label="Toggle light / dark theme" style="position:fixed; top:1rem; right:1.25rem; z-index:20;">&#127769;</button>
  <div class="topbar">
    <a href="../index.html">&larr; All Days</a>
    <span class="spacer"></span>
    <a href="script.js">&#128196; View script.js</a>
    <a href="guide.html">&#128214; Guide</a>
  </div>
  <main>
    <h1>${safeTitle}</h1>
    ${introDescription ? `<p class="intro-desc">${escapeHtml(introDescription)}</p>` : ''}
${sectionsHtml}
  </main>
  <script>
    var themeToggle = document.getElementById('themeToggle');
    function currentTheme() {
      return document.documentElement.getAttribute('data-theme') ||
        (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    }
    themeToggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('jscore-theme', next); } catch (e) {}
    });
  </script>
  <script>
  (function () {
    var currentSection = 1; // default bucket for any pre-marker output
    window.__jsSection = function (n) { currentSection = n; };
    // Call-boundary wrap: while a section's own top-level function is
    // synchronously running, the global fallback section is pinned to it —
    // so a shared preamble helper it calls (no shadowed console of its own)
    // still attributes correctly via that global, same as top-level section
    // code does. Does NOT, by itself, survive an await suspension inside
    // the wrapped function — that's what the lexical console shadow (see
    // __sectionConsole below) is for; the two work together.
    window.__wrapSection = function (section, fn) {
      var wrapped = function () {
        var prev = currentSection;
        currentSection = section;
        try {
          return fn.apply(this, arguments);
        } finally {
          currentSection = prev;
        }
      };
      // A plain zero-arg wrapper function always reports .length === 0,
      // which would silently corrupt any code that inspects a function's
      // declared arity (e.g. a curry() implementation deciding how many
      // arguments to wait for via fn.length) — mirror the original's
      // .length and .name so wrapping stays introspection-transparent.
      try { Object.defineProperty(wrapped, 'length', { value: fn.length, configurable: true }); } catch (e) {}
      try { Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true }); } catch (e) {}
      return wrapped;
    };
    function safeStringify(obj) {
      try { return JSON.stringify(obj); } catch (e) { return String(obj); }
    }
    function formatArg(a) {
      if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
      if (typeof a === 'object' && a !== null) return safeStringify(a);
      return String(a);
    }
    function appendToSection(n, text, isError) {
      var container = document.getElementById('output-' + n);
      if (!container) return;
      var line = document.createElement('div');
      line.className = 'log-line' + (isError ? ' log-error' : '');
      line.textContent = text;
      container.appendChild(line);
    }
    var realConsoleLog = console.log.bind(console);
    var realConsoleError = console.error.bind(console);
    function recordLog(n, args, isError) {
      appendToSection(n, Array.prototype.map.call(args, formatArg).join(' '), isError);
    }

    // Default console (used by genuinely top-level section code, outside any
    // function) — attributes to whatever __jsSection(N) last set.
    console.log = function () { realConsoleLog.apply(console, arguments); recordLog(currentSection, arguments, false); };
    console.error = function () { realConsoleError.apply(console, arguments); recordLog(currentSection, arguments, true); };

    // Per-function console (used by instrumented top-level function bodies,
    // see buildInstrumented's comment for why this is lexical, not a call
    // wrapper) — a fixed section baked in via closure, immune to whatever
    // order async callbacks/await continuations actually fire in.
    window.__sectionConsole = function (n) {
      return {
        log: function () { realConsoleLog.apply(console, arguments); recordLog(n, arguments, false); },
        error: function () { realConsoleError.apply(console, arguments); recordLog(n, arguments, true); },
        warn: function () { realConsoleLog.apply(console, arguments); recordLog(n, arguments, false); },
        info: function () { realConsoleLog.apply(console, arguments); recordLog(n, arguments, false); },
      };
    };

    // Propagate "which section scheduled this" across async boundaries, so
    // a callback registered in one section is still attributed to that
    // section however much later it actually fires.
    var origSetTimeout = window.setTimeout;
    window.setTimeout = function (fn, delay) {
      var captured = currentSection;
      var extraArgs = Array.prototype.slice.call(arguments, 2);
      return origSetTimeout(function () {
        var prev = currentSection;
        currentSection = captured;
        try { fn.apply(this, extraArgs); } finally { currentSection = prev; }
      }, delay);
    };

    var origThen = Promise.prototype.then;
    Promise.prototype.then = function (onFulfilled, onRejected) {
      var captured = currentSection;
      function wrap(fn) {
        if (typeof fn !== 'function') return fn;
        return function (value) {
          var prev = currentSection;
          currentSection = captured;
          try { return fn(value); } finally { currentSection = prev; }
        };
      }
      return origThen.call(this, wrap(onFulfilled), wrap(onRejected));
    };

    if (window.queueMicrotask) {
      var origQueueMicrotask = window.queueMicrotask;
      window.queueMicrotask = function (fn) {
        var captured = currentSection;
        origQueueMicrotask(function () {
          var prev = currentSection;
          currentSection = captured;
          try { fn(); } finally { currentSection = prev; }
        });
      };
    }

    if (window.requestAnimationFrame) {
      var origRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = function (fn) {
        var captured = currentSection;
        return origRAF(function (ts) {
          var prev = currentSection;
          currentSection = captured;
          try { fn(ts); } finally { currentSection = prev; }
        });
      };
    }

    window.addEventListener('error', function (e) {
      recordLog(currentSection, ['Uncaught error: ' + e.message], true);
    });
    window.addEventListener('unhandledrejection', function (e) {
      var reason = e.reason && e.reason.message ? e.reason.message : String(e.reason);
      recordLog(currentSection, ['Unhandled promise rejection: ' + reason], true);
    });

    var SOURCE = ${embedded};
    try {
      new Function(SOURCE)();
    } catch (err) {
      recordLog(currentSection, ['Script crashed: ' + err.message], true);
    }

    // After things settle, label any section that produced no output (e.g.
    // Node-only code that's naturally skipped when run in a browser).
    setTimeout(function () {
      document.querySelectorAll('.section-output').forEach(function (el) {
        if (!el.hasChildNodes()) {
          var note = document.createElement('div');
          note.className = 'log-line log-muted';
          note.textContent = '(no output from this section in the browser — it may be Node-only code; run "node script.js" in a terminal to see it)';
          el.appendChild(note);
        }
      });
    }, 3000);
  })();
  </script>
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
let skipped = 0;
for (const dir of dayDirs) {
  const scriptPath = path.join(root, dir, 'script.js');
  if (!fs.existsSync(scriptPath)) {
    console.warn(`skip ${dir}: no script.js found`);
    continue;
  }
  const source = fs.readFileSync(scriptPath, 'utf8');
  const { intro, sections, lines, banners } = parseScript(source);
  const instrumented = buildInstrumented(lines, banners);

  // Build-time safety check: make sure the instrumented source still
  // compiles. If instrumentation somehow broke syntax, fall back to the
  // ORIGINAL, unmodified source (sections still display correctly; only
  // per-section output attribution is lost for that one day).
  let finalSource = instrumented;
  try {
    // eslint-disable-next-line no-new-func
    new Function(instrumented);
  } catch (err) {
    console.warn(`${dir}: instrumented script.js failed to compile (${err.message}) — falling back to uninstrumented source`);
    try {
      new Function(source);
      finalSource = source;
    } catch (err2) {
      console.warn(`${dir}: original script.js also failed to compile standalone (${err2.message}) — page will show a script error`);
      finalSource = source;
    }
  }

  const titleMatch = source.match(/DAY\s+\d+\s*[:—-]\s*(.+)/i) || (intro && [null, intro.title]);
  const dayNumMatch = dir.match(/^day-(\d{2})-/);
  const dayNum = dayNumMatch ? dayNumMatch[1] : '';
  const titleText = titleMatch ? titleMatch[1].replace(/\s*=+\s*$/, '').trim() : dir;
  const title = `Day ${dayNum} — ${titleText}`;

  const html = page({
    title,
    introTitle: intro ? intro.title : null,
    introDescription: intro ? intro.description : '',
    sections,
    instrumentedSource: finalSource,
  });

  fs.writeFileSync(path.join(root, dir, 'index.html'), html, 'utf8');
  built++;
}
console.log(`Built ${built} sandbox index.html page(s) from script.js files (${skipped} skipped).`);
