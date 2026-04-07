let data;
let citationsData;
let citationLookup; // Map: normalized raw → citation object
let edit = 0;

function preload() {
  data = loadJSON('get%20citations/boston_marathon_bombing_suspect_edits.json');
  citationsData = loadJSON('get%20citations/citations.json');
}

function buildCitationLookup() {
  citationLookup = new Map();
  // Primary: by normalized raw string
  for (const c of citationsData.citations) {
    if (c.raw) {
      const key = normalizeRaw(c.raw);
      if (!citationLookup.has(key)) citationLookup.set(key, c);
    }
  }
  // Secondary: by URL (first match per URL wins)
  citationLookup._byUrl = new Map();
  for (const c of citationsData.citations) {
    if (c.url) {
      const key = normalizeUrl(c.url);
      if (!citationLookup._byUrl.has(key)) citationLookup._byUrl.set(key, c);
    }
  }
}

function normalizeRaw(raw) {
  return raw.trim().replace(/\s+/g, ' ');
}

function normalizeUrl(url) {
  try { return new URL(url).pathname; } catch { return url; }
}

function lookupCitation(raw) {
  const c = citationLookup.get(normalizeRaw(raw));
  if (c) return c;
  // Extract URL from the raw wikitext and try URL lookup
  const m = raw.match(/url\s*=\s*(https?:\/\/[^\s|}\]]+)/i) ||
            raw.match(/(https?:\/\/[^\s|}\]]+)/);
  if (!m) return null;
  const path = normalizeUrl(m[1]);
  // Exact path match
  if (citationLookup._byUrl.has(path)) return citationLookup._byUrl.get(path);
  // Prefix match — handles truncated URLs in wikitext
  for (const [key, val] of citationLookup._byUrl) {
    if (key.startsWith(path) || path.startsWith(key)) return val;
  }
  return null;
}

function setup() {
  buildCitationLookup();
  noCanvas();
  showEdit();
}

function keyPressed() {
  if (keyCode === RIGHT_ARROW && edit < data.revisions.length - 1) next();
  if (keyCode === LEFT_ARROW && edit > 0) prev();
}

function showEdit() {
  let e = data.revisions[edit];
  let refMap = buildRefMap(e);

  console.log(e.revid);
  select('#wiki-link').attribute('href', `https://en.wikipedia.org/w/index.php?diff=${e.revid}`);
  select('#editor').html(e.user);
  select('#comment').html(cleanWikitext(e.comment));

  let formatted = formatDateTime(e.timestamp);
  select('#date').html(formatted.date);
  select('#time').html(formatted.time);

  // shared citation state across all sections
  let sharedCiteState = { counter: 0, nameToNum: {}, citations: [] };

  let sectionBlocks = e.changed_sections.map(name => {
    let section = e.section_text_after[name];
    let wikitext = section ? section.wikitext : '';

    if (!wikitext) {
      return `<div class="section-block"><div class="section-removed">section removed</div></div>`;
    }

    let { body } = parseSectionWithCitations(wikitext, refMap, sharedCiteState);

    if (!body) {
      return `<div class="section-block"><div class="section-removed">section removed</div></div>`;
    }

    let bodyHtml = body
      .replace(/(\n\s*){2,}/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/\[(\d+)\]/g, (_, n) => `<sup class="cite-ref"><a href="#cite-${n}">[${n}]</a></sup>`);

    return `<div class="section-block">
      <div class="section-heading">${name}</div>
      <div class="section-body"><p>${bodyHtml}</p></div>
    </div>`;
  });

  let citesHtml = '';
  if (sharedCiteState.citations.length) {
    citesHtml = `<div class="section-block">
      <div class="section-heading">References</div>
      <ol class="cite-list">` +
        sharedCiteState.citations.map(c => `<li id="cite-${c.num}">${renderCitationContent(c.content)}</li>`).join('') +
      `</ol>
    </div>`;
  }

  let html = sectionBlocks.join('') + citesHtml;

  select('#text').html(html);
  select('#section').html('');
  renderTimeline();
}

function prev() {
  edit--;
  showEdit();
}

function next() {
  edit++;
  showEdit();
}

function formatDateTime(timestamp) {
  let dt = new Date(timestamp);
  let formatted_date = dt.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  let formatted_time = dt.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });
  return { date: formatted_date, time: formatted_time };
}

function cleanWikitext(str) {
  return str
    .replace(/\/\*[^*]*\*\/\s*/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .trim();
}

// Scan all sections of a revision to build a name→content map for named refs
function buildRefMap(revision) {
  let map = {};
  for (const sec of Object.values(revision.section_text_after)) {
    for (const m of sec.wikitext.matchAll(/<ref\s+name\s*=\s*(?:"([^"]+)"|'([^']+)'|([^"'>/\s]+))\s*>([\s\S]*?)<\/ref>/gi)) {
      const name = (m[1] || m[2] || m[3]).trim();
      if (!map[name]) map[name] = m[4].trim();
    }
  }
  return map;
}

// Remove [[File:...]] and [[Image:...]] blocks, correctly handling nested brackets
function removeFileLinks(text) {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '[' && text[i + 1] === '[') {
      let contentStart = i + 2;
      let isFile = /^(?:File|Image):/i.test(text.slice(contentStart));
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === '[' && text[i + 1] === '[') { depth++; i += 2; }
        else if (text[i] === ']' && text[i + 1] === ']') { depth--; i += 2; }
        else i++;
      }
      if (!isFile) result += text.slice(contentStart - 2, i);
    } else {
      result += text[i++];
    }
  }
  return result;
}

function parseSectionWithCitations(wikitext, refMap, state = { counter: 0, nameToNum: {}, citations: [] }) {
  let { citations, nameToNum } = state;

  function addCitation(name, content) {
    if (name && nameToNum[name] !== undefined) return nameToNum[name];
    const existing = citations.find(c => c.content === content);
    if (existing) {
      if (name) nameToNum[name] = existing.num;
      return existing.num;
    }
    const num = ++state.counter;
    if (name) nameToNum[name] = num;
    citations.push({ num, content });
    return num;
  }

  let text = wikitext.replace(/<!--[\s\S]*?-->/g, '');

  // Named refs with inline content: <ref name="X">...</ref>
  text = text.replace(/<ref\s+name\s*=\s*(?:"([^"]+)"|'([^']+)'|([^"'>/\s]+))\s*>([\s\S]*?)<\/ref>/gi, (_, q1, q2, bare, content) => {
    const name = (q1 || q2 || bare).trim();
    return `[${addCitation(name, content.trim())}]`;
  });

  // Unnamed refs with inline content: <ref>...</ref>
  text = text.replace(/<ref>([\s\S]*?)<\/ref>/gi, (_, content) =>
    `[${addCitation(null, content.trim())}]`
  );

  // Self-closing named back-references: <ref name="X" />
  text = text.replace(/<ref\s+name\s*=\s*(?:"([^"]+)"|'([^']+)'|([^"'>/\s]+))\s*\/>/gi, (_, q1, q2, bare) => {
    const name = (q1 || q2 || bare).trim();
    const content = refMap[name];
    if (!content) return ''; // definition not in this edit, skip silently
    return `[${addCitation(name, content)}]`;
  });

  text = text.replace(/<\/?ref[^>]*>/gi, '');
  text = removeFileLinks(text);
  text = text.replace(/\[\[User(?:[ _]talk)?:[^\]]+\]\]/gi, '');
  text = text.replace(/\d{1,2}:\d{2},\s*\d{1,2}\s+\w+\s+\d{4}\s*\(UTC\)/g, '');
  text = text.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1');
  for (let i = 0; i < 3; i++) text = text.replace(/\{\{[^{}]*\}\}/g, '');
  text = text.replace(/'{2,3}/g, '');
  text = text.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1'); // [URL anchor text] → anchor text
  text = text.replace(/\[https?:\/\/\S+\]/g, '');             // [URL] → remove
  text = text.replace(/https?:\/\/\S+/g, '');                 // bare URLs → remove
  text = text.replace(/thumb(?:nail)?\|(?:(?:right|left|center|\d+px)\|)?[^\n]*/gi, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return { body: text };
}

function renderCitationContent(content) {
  content = content.trim();

  // Try lookup in pre-parsed citations.json first
  const c = lookupCitation(content);
  if (c) return formatCitation(c);

  // Single-bracket external link: [URL text] possibly mixed with surrounding text
  const parts = content.split(/(\[https?:\/\/\S+(?:\s+[^\]]+)?\])/);
  if (parts.length > 1) {
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        const m = part.match(/^\[(https?:\/\/\S+)(?:\s+([\s\S]*?))?\]$/);
        if (m) {
          const text = m[2] ? m[2].trim() : m[1];
          return `<a href="${m[1]}" target="_blank">${cleanCitationText(text)}</a>`;
        }
      }
      return cleanCitationText(part);
    }).join('');
  }

  // Bare URL
  const urlMatch = content.match(/^(https?:\/\/\S+)/);
  if (urlMatch) return `<a href="${urlMatch[1]}" target="_blank">${escapeHtml(urlMatch[1])}</a>`;

  return cleanCitationText(content);
}

function formatCitation(c) {
  let parts = [];
  if (c.author) parts.push(escapeHtml(c.author));
  if (c.title) {
    const safeUrl = c.url && /^https?:\/\//.test(c.url) ? c.url : '';
    parts.push(safeUrl
      ? `<a href="${safeUrl}" target="_blank">"${escapeHtml(c.title)}"</a>`
      : `"${escapeHtml(c.title)}"`);
  }
  if (c.publisher) parts.push(`<em>${escapeHtml(c.publisher)}</em>`);
  if (c.date)      parts.push(escapeHtml(c.date));
  if (parts.length) return parts.join('. ');
  if (c.url) return `<a href="${c.url}" target="_blank">${escapeHtml(c.url)}</a>`;
  return escapeHtml(c.raw || '');
}

function cleanCitationText(str) {
  return escapeHtml(str.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1'));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTimeline() {
  let timestamps = data.revisions.map(e => new Date(e.timestamp));
  let firstTime = timestamps[0];
  let lastTime  = timestamps[timestamps.length - 1];
  let totalRange = lastTime - firstTime;

  function toPct(t) {
    return totalRange === 0 ? 50 : (t - firstTime) / totalRange * 100;
  }

  let container = select('#timeline');
  container.html('');

  let track = createDiv('');
  track.class('timeline-track');
  track.parent(container);

  // day markers — tick + label at midnight of each day
  let seenDays = new Set();
  for (let e of data.revisions) {
    let date = e.timestamp.split('T')[0];
    if (seenDays.has(date)) continue;
    seenDays.add(date);
    let midnight = new Date(`${date}T00:00:00Z`);
    let pct = Math.max(0, Math.min(100, toPct(midnight)));

    let tick = createDiv('');
    tick.class('timeline-tick');
    tick.style('left', pct + '%');
    tick.parent(container);

    let label = createDiv(midnight.getUTCDate());
    label.class('timeline-day-label');
    label.style('left', pct + '%');
    label.parent(container);
  }

  // one dot per revision
  for (let i = 0; i < data.revisions.length; i++) {
    let dot = createDiv('');
    dot.class(i === edit ? 'timeline-dot current' : 'timeline-dot');
    dot.style('left', toPct(timestamps[i]) + '%');
    dot.parent(container);

    let idx = i;
    dot.mousePressed(() => { edit = idx; showEdit(); });
  }
}
