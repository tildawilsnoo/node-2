let data;
let citationsRaw;
let citationMap = {};
let refNameToId = {};
let urlToId = {};
let rawRefToId = {};
let edit = 0;

// Canonical article section order (grouped by how they appeared in the article structure)
const SECTION_ORDER = [
  'Investigation',
  'Suspects',
  'Arrest', 'Arrests',
  'Other arrests', 'Other arrests and detentions',
  'Conflicting reports',
];

function preload() {
  data = loadJSON('edits_with_citations.json');
  citationsRaw = loadJSON('citations.json');
}

function setup() {
  noCanvas();
  refNameToId = citationsRaw.ref_name_index || {};
  rawRefToId = citationsRaw.raw_ref_index || {};
  for (let c of citationsRaw.citations) {
    citationMap[c.citation_id] = c;
    if (c.url) urlToId[c.url.trim().replace(/\/$/, '')] = c.citation_id;
  }

  // Forward pass: build a running snapshot of all section states per revision
  let sectionState = {};
  for (let rev of data.revisions) {
    for (let [name, val] of Object.entries(rev.section_text_after || {})) {
      sectionState[name] = val;
    }
    rev.sectionSnapshot = Object.assign({}, sectionState);
  }

  // Keep only INCLUDE-marked revisions
  data.revisions = data.revisions.filter(rev => rev.manual_subplot === 'INCLUDE');

  // Filter out revisions where the visible plaintext didn't change
  let prevPlaintext = null;
  data.revisions = data.revisions.filter(rev => {
    let plaintext = SECTION_ORDER
      .map(name => (rev.sectionSnapshot[name] || {}).plaintext || '')
      .join('\n');
    if (plaintext === prevPlaintext) return false;
    prevPlaintext = plaintext;
    return true;
  });

  showEdit();

  let jumpInput = select('#jump-input');
  let jumpMsg   = select('#jump-msg');
  jumpInput.elt.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    let id = parseInt(jumpInput.elt.value.trim());
    let idx = data.revisions.findIndex(r => r.revid === id);
    if (idx === -1) {
      jumpMsg.html('not found');
    } else {
      edit = idx;
      showEdit();
      jumpMsg.html('');
    }
  });
}

function keyPressed() {
  if (keyCode === RIGHT_ARROW && edit < data.revisions.length - 1) next();
  if (keyCode === LEFT_ARROW && edit > 0) prev();
}

function showEdit() {
  let e = data.revisions[edit];
  console.log(e.revid);

  select('#wiki-link').attribute('href', `https://en.wikipedia.org/w/index.php?diff=${e.revid}`);
  select('#editor').html(e.user);
  select('#comment').html(cleanWikitext(e.comment));

  let formatted = formatDateTime(e.timestamp);
  select('#date').html(formatted.date);
  select('#time').html(formatted.time);

  let next = data.revisions[edit + 1];
  if (next) {
    let ms = new Date(next.timestamp) - new Date(e.timestamp);
    select('#live-duration').html('Live for ' + formatDuration(ms));
  } else {
    select('#live-duration').html('');
  }

  let snapshot = e.sectionSnapshot || {};
  let prevSnapshot = edit > 0 ? data.revisions[edit - 1].sectionSnapshot : {};

  // Derive citation ids from all visible sections in order
  let allCitationIds = [];
  let cidSeen = new Set();
  for (let val of Object.values(snapshot)) {
    for (let cid of extractCitationIds(val.wikitext || '')) {
      if (!cidSeen.has(cid)) { allCitationIds.push(cid); cidSeen.add(cid); }
    }
  }
  let cidToNumber = {};
  allCitationIds.forEach((cid, i) => { cidToNumber[cid] = i + 1; });

  let sortedEntries = Object.entries(snapshot).sort(([a], [b]) => {
    let ai = SECTION_ORDER.indexOf(a);
    let bi = SECTION_ORDER.indexOf(b);
    if (ai === -1) ai = SECTION_ORDER.length;
    if (bi === -1) bi = SECTION_ORDER.length;
    return ai - bi;
  });

  let sections = sortedEntries.map(([name, val]) => {
    let currHTML = wikitextToPlaintext(val.wikitext || '', cidToNumber);
    let prevVal = prevSnapshot[name];
    if (prevVal) {
      let prevHTML = wikitextToPlaintext(prevVal.wikitext || '', cidToNumber);
      let currText = currHTML.replace(/<[^>]+>/g, '');
      let prevText = prevHTML.replace(/<[^>]+>/g, '');
      if (currText !== prevText) {
        return { name, text: applyWordHighlights(currHTML, prevHTML) };
      }
    }
    return { name, text: currHTML };
  });

  let hasAnyText = sections.some(s => s.text);

  let html = hasAnyText
    ? sections.filter(s => s.text).map(({ name, text }) =>
        `<div class="section-block">
          <div class="section-heading">${name}</div>
          <div class="section-body"><p>${text}</p></div>
        </div>`
      ).join('')
    : `<div class="section-block"><div class="section-removed">section removed</div></div>`;

  select('#text').html(html);
  styleText();
  renderReferences(allCitationIds);
  renderTimeline();
}

function renderReferences(citationIds) {
  let container = select('#references');
  if (!citationIds.length) {
    container.html('');
    return;
  }

  let items = citationIds.map((id, i) => {
    let c = citationMap[id];
    if (!c) return `<li value="${i + 1}" id="ref-${i + 1}">${id}</li>`;

    let parts = [];

    if (c.author) parts.push(c.author.replace(/\.+$/, '') + '.');

    let title = null;
    if (c.title) {
      let inner = c.title.match(/^[""\u201c]([^""\u201d]+)[""\u201d]/);
      title = inner ? inner[1].trim() : c.title.replace(/\.+$/, '').trim();
    }
    if (title && c.url) {
      parts.push(`"<a href="${c.url}" target="_blank" rel="noopener">${title}</a>".`);
    } else if (title) {
      parts.push(`"${title}".`);
    } else if (c.url) {
      parts.push(`<a href="${c.url}" target="_blank" rel="noopener">${c.url}</a>.`);
    } else if (c.raw_ref) {
      parts.push(c.raw_ref);
    }

    let venue = c.newspaper || c.publisher || c.work;
    if (venue) parts.push(`<i>${venue}</i>.`);

    if (c.date) parts.push(c.date + '.');

    if (c.access_date) parts.push(`Retrieved ${c.access_date}.`);

    return `<li value="${i + 1}" id="ref-${i + 1}">${parts.join(' ')}</li>`;
  }).join('');

  container.html(`
    <div class="section-heading">References</div>
    <ol class="references-list">${items}</ol>
  `);
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

function formatDuration(ms) {
  let s = Math.floor(ms / 1000);
  let m = Math.floor(s / 60);
  let h = Math.floor(m / 60);
  let d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function cleanWikitext(str) {
  return str
    .replace(/\/\*[^*]*\*\/\s*/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .trim();
}

function wikitextToPlaintext(wikitext, cidToNumber = {}) {
  // Replace <ref> tags with placeholders so the HTML-stripping step below
  // doesn't destroy the superscript markup we'll restore afterward.
  let placeholders = [];
  function refPlaceholder(attrs, content = '') {
    let cid = resolveCid(attrs, content);
    let n = cid ? cidToNumber[cid] : null;
    if (!n) return '';
    let html = `<sup class="cite-ref"><a href="#ref-${n}">[${n}]</a></sup>`;
    let token = `\x00CITE${placeholders.length}\x00`;
    placeholders.push(html);
    return token;
  }

  let text = wikitext
    .replace(/\[\[(?:File|Image):(?:[^\[\]]|\[\[[^\]]*\]\])*\]\]/gi, '') // remove File/Image embeds (handles nested wikilinks in captions)
    .replace(/<ref\b([^>]*)>([\s\S]*?)<\/ref>/gi, (_, attrs, content) => refPlaceholder(attrs, content))
    .replace(/<ref\b([^>]*)\/>/gi, (_, attrs) => refPlaceholder(attrs))
    .replace(/\n(\x00CITE\d+\x00)/g, '$1')            // drop newline before inline cite superscripts
    .replace(/<!--[\s\S]*?-->/g, '')                  // remove HTML comments
    .replace(/\{\{lang(?:-[a-z]+)?\|(?:[a-z-]+\|)?([^}|]+)\}\}/gi, '$1') // {{lang-ru|text}} → text
    .replace(/\{\{(?:birth|death) date(?:[^|{}]*)?\|(\d{4})\|(\d{1,2})\|(\d{1,2})[^}]*\}\}/gi, (_, y, m, d) => { // {{Birth/Death date|Y|M|D}} → formatted date
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      return `${months[+m-1]} ${+d}, ${y}`;
    })
    .replace(/\{\{[^{}]*\}\}/g, '')                   // remove {{templates}}
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1') // [[Target|Label]] -> Label
    .replace(/'{2,3}([^']+)'{2,3}/g, '$1')            // ''italic''/'''bold''' -> text
    .replace(/<[^>]+>/g, '')                          // strip remaining HTML tags
    .replace(/^={3,}\s*(.+?)\s*={3,}\s*$/gm, '\n\n<span class="section-subheading">$1</span>\n\n') // ===subheadings===
    .replace(/((?:^[*#][^\n]*\n?)+)/gm, match => {         // wiki bullet/numbered lists → <ul>/<ol><li>
      const isOrdered = match.trimStart().startsWith('#');
      const tag = isOrdered ? 'ol' : 'ul';
      const items = match.trim().split('\n').filter(l => l.trim())
        .map(l => `<li>${l.replace(/^[*#]+\s*/, '')}</li>`).join('');
      return `\n<${tag}>${items}</${tag}>\n`;
    })
    .replace(/thumb(?:nail)?\|(?:(?:right|left|center|\d+px)\|)?[^\n]*/gi, '')
    .replace(/\[https?:\/\/\S+\]/g, '')                   // remove bare [url] links (no title)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[\]/g, '')                                  // remove empty brackets left after URL removal
    .replace(/\([^)]*\)/g, m => m.replace(/\s|[-–—,;]/g, '').length > 2 ? m : '') // remove parentheticals that are empty or contain only punctuation
    .replace(/\[\d+\]/g, '')                               // strip legacy [N] citation markers
    .replace(/[^\s\x00]+\s*\(talk\)\s*\d{2}:\d{2},\s*\d+\s+\w+\s+\d{4}\s*\(UTC\)/g, '')
    .replace(/^[^\n]+\|thumb(?:nail)?(?:\|(?:right|left|center|\d+px))*\s*$/gim, '')
    .replace(/thumb(?:nail)?(?:\|(?:right|left|center|\d+px))*\|[^\n]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Restore superscript HTML from placeholders
  return text.replace(/\x00CITE(\d+)\x00/g, (_, i) => placeholders[+i]);
}

function resolveCid(attrs, content) {
  let nameMatch = attrs.match(/name\s*=\s*["']?([^"'>/\s]+)["']?/i);
  let refName = nameMatch ? nameMatch[1] : null;
  let cid = refName ? refNameToId[refName] : null;
  if (!cid) {
    let urlMatch = content.match(/https?:\/\/[^\s|"'\]}>]+/);
    if (urlMatch) cid = urlToId[urlMatch[0].trim().replace(/\/$/, '')];
  }
  if (!cid) cid = rawRefToId[content.replace(/<!--[\s\S]*?-->/g, '').trim()];
  return cid || null;
}

function extractCitationIds(wikitext) {
  let ids = [];
  let seen = new Set();
  function tryAdd(cid) { if (cid && !seen.has(cid)) { ids.push(cid); seen.add(cid); } }
  wikitext.replace(/<ref\b([^>]*)>([\s\S]*?)<\/ref>/gi, (_, attrs, content) => { tryAdd(resolveCid(attrs, content)); return ''; });
  wikitext.replace(/<ref\b([^>]*)\/>/gi, (_, attrs) => { tryAdd(resolveCid(attrs, '')); return ''; });
  return ids;
}

function styleText() {
  selectAll('.section-body').forEach(el => {
    let content = el.html();
    // Protect subheading spans before the newline-stripping pass
    let subheadings = [];
    content = content.replace(/<span class="section-subheading">[^<]*<\/span>/g, m => {
      let token = `\x00SH${subheadings.length}\x00`;
      subheadings.push(m);
      return token;
    });
    content = content.replace(/>\n+</g, '><').replace(/(\n\s*){2,}/g, '</p><p>').replace(/\n/g, '<br>');
    // Restore subheadings as block elements between paragraphs
    content = content.replace(/\x00SH(\d+)\x00/g, (_, i) => `</p>${subheadings[+i]}<p>`);
    content = content.replace(/<p>\s*<\/p>/g, '');
    el.html(content);
  });
}

function applyWordHighlights(currHTML, prevHTML) {
  // Strip <sup> blocks and subheading spans entirely, then strip remaining tags.
  // Both steps must match: the walker also skips these blocks as non-text so the
  // character offsets stay aligned with the stripped comparison text.
  const stripForDiff = s => s
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')
    .replace(/<span class="section-subheading">[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n');
  const currText = stripForDiff(currHTML);
  const prevText = stripForDiff(prevHTML);
  if (currText === prevText) return currHTML;

  const tokens = wordDiff(prevText, currText);
  let result = '';
  let pos = 0;

  // Advance past any non-text content at current pos, appending it to chunk.
  // Non-text = HTML tags and entire <sup>…</sup> blocks (whose inner text was
  // stripped from the comparison strings and must not count toward remain).
  function copyNonText(chunk) {
    while (pos < currHTML.length && currHTML[pos] === '<') {
      const supM = currHTML.slice(pos).match(/^<sup[\s\S]*?<\/sup>/i);
      if (supM) {
        chunk += supM[0];
        pos += supM[0].length;
      } else {
        const subhM = currHTML.slice(pos).match(/^<span class="section-subheading">[\s\S]*?<\/span>/);
        if (subhM) {
          chunk += subhM[0];
          pos += subhM[0].length;
        } else {
          const end = currHTML.indexOf('>', pos) + 1;
          chunk += currHTML.slice(pos, end);
          pos = end;
        }
      }
    }
    return chunk;
  }

  for (const tok of tokens) {
    if (tok.t === '-') {
      const esc = tok.v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      result += `<span class="word-rem">${esc}</span>`;
      continue;
    }
    let remain = tok.v.length;
    let chunk = '';
    while (remain > 0 && pos < currHTML.length) {
      chunk = copyNonText(chunk);
      if (remain > 0 && pos < currHTML.length) {
        chunk += currHTML[pos++];
        remain--;
      }
    }
    result += tok.t === '+' ? `<span class="word-add">${chunk}</span>` : chunk;
  }

  // Flush any trailing non-text (citations at end of section, etc.)
  let tail = '';
  tail = copyNonText(tail);
  return result + tail + currHTML.slice(pos);
}

function wordDiff(a, b) {
  const tokA = (a || '').match(/\S+|\s+/g) || [];
  const tokB = (b || '').match(/\S+|\s+/g) || [];
  const m = tokA.length, n = tokB.length;
  const dp = new Uint32Array((m + 1) * (n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * (n + 1) + j] = tokA[i] === tokB[j]
        ? dp[(i + 1) * (n + 1) + (j + 1)] + 1
        : Math.max(dp[(i + 1) * (n + 1) + j], dp[i * (n + 1) + (j + 1)]);
    }
  }
  let i = 0, j = 0;
  const out = [];
  while (i < m || j < n) {
    if (i < m && j < n && tokA[i] === tokB[j]) {
      out.push({ t: '=', v: tokA[i] }); i++; j++;
    } else if (j < n && (i >= m || dp[i * (n + 1) + (j + 1)] >= dp[(i + 1) * (n + 1) + j])) {
      out.push({ t: '+', v: tokB[j] }); j++;
    } else {
      out.push({ t: '-', v: tokA[i] }); i++;
    }
  }
  return out;
}


function edtDayStart(t) {
  // Returns midnight EDT (UTC-4) of the day containing t
  let edtMs = t.getTime() - 4 * 3600 * 1000;
  let d = new Date(edtMs);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + 4 * 3600 * 1000);
}

function renderTimeline() {
  let bombTime  = new Date('2013-04-15T18:49:00Z');
  let lastTime  = new Date(data.revisions[data.revisions.length - 1].timestamp);
  let start = new Date(bombTime.getTime() - 3600 * 1000);
  let end   = new Date(lastTime.getTime()  + 3600 * 1000);

  function toPct(t) {
    return (t - start) / (end - start) * 100;
  }

  let container = select('#timeline');
  container.html('');

  // ── Beeswarm layout ────────────────────────────────────
  const R  = 3;   // dot radius px
  const D  = R * 2;
  const cw = container.elt.offsetWidth || 900;

  let dotData = data.revisions.map((rev, i) => {
    let pct    = toPct(new Date(rev.timestamp));          // true sub-pixel x, unclamped
    let pctVis = Math.max(0, Math.min(100, pct));         // clamped only for rendering
    return { i, pct: pctVis, xPx: pct / 100 * cw, y: 0 };
  });

  let placed = [];
  for (let dot of dotData) {
    let nearby = placed.filter(p => Math.abs(p.xPx - dot.xPx) < D);
    let bestY = 0;
    for (let level = 0; ; level++) {
      let cy = -level * D;  // only go upward
      if (nearby.every(p => {
        let dx = dot.xPx - p.xPx, dy = cy - p.y;
        return dx * dx + dy * dy >= D * D;
      })) { bestY = cy; break; }
    }
    dot.y = bestY;
    placed.push(dot);
  }

  // ── Dynamic sizing ─────────────────────────────────────
  const TOP_PAD = 20;  // space above swarm for event labels
  const BOT_PAD = 22;  // space below swarm for day labels
  let maxUp   = dotData.reduce((m, d) => Math.max(m, -d.y + R), R);
  let maxDown = dotData.reduce((m, d) => Math.max(m, d.y  + R), R);
  let trackY  = maxUp + TOP_PAD;
  let totalH  = trackY + maxDown + BOT_PAD;
  container.style('height', totalH + 'px');

  // ── Track ──────────────────────────────────────────────
  let track = createDiv('');
  track.class('timeline-track');
  track.style('top', trackY + 'px');
  track.parent(container);

  // ── Day ticks + labels ─────────────────────────────────
  let months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let d = edtDayStart(start);
  if (d.getTime() < start.getTime()) d = new Date(d.getTime() + 86400000);
  while (d < end) {
    let pct = toPct(d);
    let tick = createDiv('');
    tick.class('timeline-tick');
    tick.style('left', pct + '%');
    tick.style('top',  (trackY - 4) + 'px');
    tick.style('height', '9px');
    tick.parent(container);

    let dayNum = d.getUTCDate();
    let labelText = dayNum === 1 ? months[d.getUTCMonth()] : String(dayNum);
    let label = createDiv(labelText);
    label.class('timeline-day-label');
    label.style('left', pct + '%');
    label.style('top',  (trackY + 7) + 'px');
    label.parent(container);

    d = new Date(d.getTime() + 86400000);
  }

  // ── Event markers ──────────────────────────────────────
  function addMarker(time, label) {
    let m = createDiv('');
    m.class('timeline-event up');
    m.style('left',   toPct(time) + '%');
    m.style('top',    (TOP_PAD - 4) + 'px');
    m.style('height', (trackY - TOP_PAD + 6) + 'px');
    m.parent(container);
    createDiv(label).class('timeline-event-label').parent(m);
  }

  addMarker(bombTime,                        'bomb detonates');
  addMarker(new Date('2013-04-20T00:42:00Z'), 'Tsarnaev arrested');

  // ── Below-track green labels (with vertical stacking for overlaps) ────
  const PX_PER_CHAR = 5.5;  // rough char width at 10px font
  const LABEL_H     = 13;   // label row height (text + gap)
  let belowSlots = [];       // { xPx, rightPx, bottomY } for placed labels

  function addLabelBelow(revid, text) {
    let r = data.revisions.find(r => r.revid === revid);
    if (!r) return;
    let pct     = Math.max(0, Math.min(100, toPct(new Date(r.timestamp))));
    let xPx     = pct / 100 * cw;
    let rightPx = xPx + text.length * PX_PER_CHAR + 8;

    // Find lowest non-overlapping vertical slot
    let labelY = trackY + 22;
    let changed = true;
    while (changed) {
      changed = false;
      for (let s of belowSlots) {
        if (xPx < s.rightPx && rightPx > s.xPx && labelY < s.bottomY) {
          labelY = s.bottomY;
          changed = true;
        }
      }
    }
    belowSlots.push({ xPx, rightPx, bottomY: labelY + LABEL_H });

    // Short tick at track — never extends into label territory
    let tick = createDiv('');
    tick.class('timeline-event');
    tick.style('left',       pct + '%');
    tick.style('top',        (trackY + 2) + 'px');
    tick.style('height',     '8px');
    tick.style('background', '#3c763d');
    tick.parent(container);

    // Label floats at its stacked y, independent of tick height
    let lbl = createDiv(text);
    lbl.style('position',    'absolute');
    lbl.style('left',        `calc(${pct}% + 4px)`);
    lbl.style('top',         labelY + 'px');
    lbl.style('font-size',   '10px');
    lbl.style('color',       '#3c763d');
    lbl.style('white-space', 'nowrap');
    lbl.style('line-height', '1');
    lbl.parent(container);

    // Grow container if stacked labels exceed current height
    let needed = labelY + LABEL_H + 4;
    if (needed > totalH) {
      totalH = needed;
      container.style('height', totalH + 'px');
    }
  }

  addLabelBelow(550550335, 'is there a suspect?');
  addLabelBelow(550839346, 'suspect in custody -- incorrect');
  addLabelBelow(550854877, 'FBI clarifies no arrest has been made');
  addLabelBelow(551143482, 'Tsarnaev first mentioned');

  // ── Dots ───────────────────────────────────────────────
  for (let d of dotData) {
    let isCurrent = d.i === edit;
    let size = isCurrent ? D + 2 : D;
    let dot  = createDiv('');
    dot.class('timeline-dot' + (isCurrent ? ' current' : ''));
    dot.style('left',   d.pct + '%');
    dot.style('top',    (trackY + d.y - size / 2) + 'px');
    dot.style('width',  size + 'px');
    dot.style('height', size + 'px');
    dot.parent(container);
    let idx = d.i;
    dot.mousePressed(() => { edit = idx; showEdit(); });
  }
}
