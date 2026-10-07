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
  data = loadJSON('edits_slim.json');
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

  let slider = select('#edit-slider').elt;
  slider.max = data.revisions.length - 1;
  // Re-render at most once per frame while dragging — the timeline rebuild is heavy
  let sliderPending = false;
  slider.addEventListener('input', () => {
    if (sliderPending) return;
    sliderPending = true;
    requestAnimationFrame(() => {
      sliderPending = false;
      edit = parseInt(slider.value);
      showEdit();
    });
  });

  showEdit();

  select('#prev-btn').elt.addEventListener('click', () => { if (edit > 0) prev(); });
  select('#next-btn').elt.addEventListener('click', () => { if (edit < data.revisions.length - 1) next(); });

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

  let slider = select('#edit-slider').elt;
  slider.value = edit;
  slider.style.setProperty('--fill', (edit / Math.max(1, data.revisions.length - 1) * 100) + '%');

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
  let start    = new Date('2013-04-15T04:00:00Z'); // midnight EDT Apr 15
  let end      = new Date('2013-04-21T04:00:00Z'); // midnight EDT Apr 21 = end of Apr 20

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
  const TOP_PAD = 12;  // space above swarm
  const BOT_PAD = 130;  // space below swarm for day labels + below-track labels
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
    let labelText = months[d.getUTCMonth()] + ' ' + dayNum;
    let label = createDiv(labelText);
    label.class('timeline-day-label');
    label.style('left', pct + '%');
    label.style('top',  (trackY + 7) + 'px');
    if (pct === 0) label.style('transform', 'none');
    label.parent(container);

    d = new Date(d.getTime() + 86400000);
  }

  // Closing tick at the end boundary for symmetry
  let endTick = createDiv('');
  endTick.class('timeline-tick');
  endTick.style('left', '100%');
  endTick.style('top',  (trackY - 4) + 'px');
  endTick.style('height', '9px');
  endTick.parent(container);

  // ── Shared layout constants for below-track markers ────
  const LINE_START   = trackY + 3;
  const BUBBLE_H     = 19;
  const BOMB_LABEL_Y = trackY + 30;
  const WH_LABEL_Y   = BOMB_LABEL_Y + BUBBLE_H + 4;
  const SPEC_LABEL_Y = WH_LABEL_Y + BUBBLE_H + 4;

  const bombColor    = '#5c8c78';

  // Derive x positions from dotData so lines align exactly with beeswarm dots
  const suspectDot = dotData.find(d => data.revisions[d.i].revid === 550562971);
  const suspectPct = suspectDot ? suspectDot.pct : toPct(new Date('2013-04-16T00:19:23Z'));
  const specDot    = dotData.find(d => data.revisions[d.i].revid === 550591039);
  const specPct    = specDot    ? specDot.pct    : toPct(new Date('2013-04-16T04:32:58Z'));
  const authDot    = dotData.find(d => data.revisions[d.i].revid === 550735317);
  const authPct    = authDot    ? authDot.pct    : toPct(new Date('2013-04-17T01:25:42Z'));
  const catchDot   = dotData.find(d => data.revisions[d.i].revid === 550839346);
  const catchPct   = catchDot   ? catchDot.pct   : toPct(new Date('2013-04-17T17:14:35Z'));
  const imageDot   = dotData.find(d => data.revisions[d.i].revid === 551040062);
  const imagePct   = imageDot   ? imageDot.pct   : toPct(new Date('2013-04-18T21:45:58Z'));
  const detailsDot    = dotData.find(d => data.revisions[d.i].revid === 551143482);
  const detailsPct    = detailsDot    ? detailsDot.pct    : toPct(new Date('2013-04-19T15:11:00Z'));
  const rel1Dot  = dotData.find(d => data.revisions[d.i].revid === 551175490);
  const rel1Pct  = rel1Dot  ? rel1Dot.pct  : toPct(new Date('2013-04-19T19:17:49Z'));
  const rel2Dot  = dotData.find(d => data.revisions[d.i].revid === 551216794);
  const rel2Pct  = rel2Dot  ? rel2Dot.pct  : toPct(new Date('2013-04-20T01:09:20Z'));
  const rel3Dot  = dotData.find(d => data.revisions[d.i].revid === 551233207);
  const rel3Pct  = rel3Dot  ? rel3Dot.pct  : toPct(new Date('2013-04-20T04:08:33Z'));


  // "Is there a suspect?" line rendered before hour labels so labels appear on top
  let suspectLine = createDiv('');
  suspectLine.style('position',    'absolute');
  suspectLine.style('left',        suspectPct + '%');
  suspectLine.style('top',         LINE_START + 'px');
  suspectLine.style('height',      (WH_LABEL_Y + BUBBLE_H - LINE_START) + 'px');
  suspectLine.style('width',       '0');
  suspectLine.style('border-left', '2px dotted ' + bombColor);
  suspectLine.style('transform',   'translateX(-50%)');
  suspectLine.style('pointer-events', 'none');
  suspectLine.parent(container);

  // "What counts as speculation?" line
  let specLine = createDiv('');
  specLine.style('position',    'absolute');
  specLine.style('left',        specPct + '%');
  specLine.style('top',         LINE_START + 'px');
  specLine.style('height',      (SPEC_LABEL_Y + BUBBLE_H - LINE_START) + 'px');
  specLine.style('width',       '0');
  specLine.style('border-left', '2px dotted ' + bombColor);
  specLine.style('transform',   'translateX(-50%)');
  specLine.style('pointer-events', 'none');
  specLine.parent(container);

  // "What sources are authoritative?" line
  let authLine = createDiv('');
  authLine.style('position',    'absolute');
  authLine.style('left',        authPct + '%');
  authLine.style('top',         LINE_START + 'px');
  authLine.style('height',      (BOMB_LABEL_Y + BUBBLE_H - LINE_START) + 'px');
  authLine.style('width',       '0');
  authLine.style('border-left', '2px dotted ' + bombColor);
  authLine.style('transform',   'translateX(-50%)');
  authLine.style('pointer-events', 'none');
  authLine.parent(container);

  // "Did they catch him? (no)" line
  let catchLine = createDiv('');
  catchLine.style('position',    'absolute');
  catchLine.style('left',        catchPct + '%');
  catchLine.style('top',         LINE_START + 'px');
  catchLine.style('height',      (WH_LABEL_Y + BUBBLE_H - LINE_START) + 'px');
  catchLine.style('width',       '0');
  catchLine.style('border-left', '2px dotted ' + bombColor);
  catchLine.style('transform',   'translateX(-50%)');
  catchLine.style('pointer-events', 'none');
  catchLine.parent(container);

  // "Suspect images" line
  let imageLine = createDiv('');
  imageLine.style('position',    'absolute');
  imageLine.style('left',        imagePct + '%');
  imageLine.style('top',         LINE_START + 'px');
  imageLine.style('height',      (BOMB_LABEL_Y + BUBBLE_H - LINE_START) + 'px');
  imageLine.style('width',       '0');
  imageLine.style('border-left', '2px dotted ' + bombColor);
  imageLine.style('transform',   'translateX(-50%)');
  imageLine.style('pointer-events', 'none');
  imageLine.parent(container);

  // "Suspects named" line
  let detailsLine = createDiv('');
  detailsLine.style('position',    'absolute');
  detailsLine.style('left',        detailsPct + '%');
  detailsLine.style('top',         LINE_START + 'px');
  detailsLine.style('height',      (BOMB_LABEL_Y + BUBBLE_H - LINE_START) + 'px');
  detailsLine.style('width',       '0');
  detailsLine.style('border-left', '2px dotted ' + bombColor);
  detailsLine.style('transform',   'translateX(-50%)');
  detailsLine.style('pointer-events', 'none');
  detailsLine.parent(container);

  // "What details about them are relevant?" — three lines, one per revision
  for (let pct of [rel1Pct, rel2Pct, rel3Pct]) {
    let rl = createDiv('');
    rl.style('position',    'absolute');
    rl.style('left',        pct + '%');
    rl.style('top',         LINE_START + 'px');
    rl.style('height',      (WH_LABEL_Y + BUBBLE_H - LINE_START) + 'px');
    rl.style('width',       '0');
    rl.style('border-left', '2px dotted ' + bombColor);
    rl.style('transform',   'translateX(-50%)');
    rl.style('pointer-events', 'none');
    rl.parent(container);
  }

  // ── 6-hour sub-ticks + labels ──────────────────────────
  const hourLabels = { 6: '6am', 12: '12pm', 18: '6pm' };
  let hd = edtDayStart(start);
  if (hd.getTime() < start.getTime()) hd = new Date(hd.getTime() + 86400000);
  while (hd < end) {
    for (let offset of [6, 12, 18]) {
      let t = new Date(hd.getTime() + offset * 3600 * 1000);
      if (t >= end) continue;
      let pct = toPct(t);

      let htick = createDiv('');
      htick.class('timeline-hour-tick');
      htick.style('left', pct + '%');
      htick.style('top',  (trackY - 2) + 'px');
      htick.parent(container);

      let hlabel = createDiv(hourLabels[offset]);
      hlabel.class('timeline-hour-label');
      hlabel.style('left', pct + '%');
      hlabel.style('top',  (trackY + 7) + 'px');
      hlabel.parent(container);
    }
    hd = new Date(hd.getTime() + 86400000);
  }

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
    if (data.revisions[d.i].revid === 550562971 || data.revisions[d.i].revid === 550591039 || data.revisions[d.i].revid === 550735317 || data.revisions[d.i].revid === 550839346 || data.revisions[d.i].revid === 551040062 || data.revisions[d.i].revid === 551143482 || data.revisions[d.i].revid === 551175490 || data.revisions[d.i].revid === 551216794 || data.revisions[d.i].revid === 551233207) {
      dot.style('background', isCurrent ? '#2e6b52' : bombColor);
    }
    dot.parent(container);
    let idx = d.i;
    dot.mousePressed(() => { edit = idx; showEdit(); });
  }

  // ── Bombing marker ─────────────────────────────────────
  const bombTime = new Date('2013-04-15T18:49:00Z');
  const bombPct  = toPct(bombTime);

  // Line from track alongside bombing label
  let bombLine = createDiv('');
  bombLine.style('position',    'absolute');
  bombLine.style('left',        bombPct + '%');
  bombLine.style('top',         LINE_START + 'px');
  bombLine.style('height',      (BOMB_LABEL_Y + BUBBLE_H - LINE_START) + 'px');
  bombLine.style('width',       '0');
  bombLine.style('border-left', '2px dotted ' + bombColor);
  bombLine.style('transform',   'translateX(-50%)');
  bombLine.style('pointer-events', 'none');
  bombLine.parent(container);

  // Bombing label — renders on top of wh line, covering it
  let bombLabel = createDiv('Bombing, 2:49 PM');
  bombLabel.style('position',      'absolute');
  bombLabel.style('left',          bombPct + '%');
  bombLabel.style('top',           BOMB_LABEL_Y + 'px');
  bombLabel.style('transform',     'translateX(-14px)');
  bombLabel.style('font-size',     '11px');
  bombLabel.style('font-weight',   '600');
  bombLabel.style('color',         bombColor);
  bombLabel.style('white-space',   'nowrap');
  bombLabel.style('line-height',   '1');
  bombLabel.style('background',    '#edf6f2');
  bombLabel.style('border',        '1px solid ' + bombColor);
  bombLabel.style('border-radius', '10px');
  bombLabel.style('padding',       '3px 7px');
  bombLabel.style('pointer-events','none');
  bombLabel.parent(container);



  // "Is there a suspect?" label — renders last, on top
  let suspectLabel = createDiv('Is there a suspect?');
  suspectLabel.style('position',      'absolute');
  suspectLabel.style('left',          suspectPct + '%');
  suspectLabel.style('top',           WH_LABEL_Y + 'px');
  suspectLabel.style('transform',     'translateX(-14px)');
  suspectLabel.style('font-size',     '11px');
  suspectLabel.style('font-weight',   '600');
  suspectLabel.style('color',         bombColor);
  suspectLabel.style('white-space',   'nowrap');
  suspectLabel.style('line-height',   '1');
  suspectLabel.style('background',    '#edf6f2');
  suspectLabel.style('border',        '1px solid ' + bombColor);
  suspectLabel.style('border-radius', '10px');
  suspectLabel.style('padding',       '3px 7px');
  suspectLabel.style('pointer-events','none');
  suspectLabel.parent(container);

  // "What counts as speculation?" label
  let specLabel = createDiv('What counts as speculation?');
  specLabel.style('position',      'absolute');
  specLabel.style('left',          specPct + '%');
  specLabel.style('top',           SPEC_LABEL_Y + 'px');
  specLabel.style('transform',     'translateX(-14px)');
  specLabel.style('font-size',     '11px');
  specLabel.style('font-weight',   '600');
  specLabel.style('color',         bombColor);
  specLabel.style('white-space',   'nowrap');
  specLabel.style('line-height',   '1');
  specLabel.style('background',    '#edf6f2');
  specLabel.style('border',        '1px solid ' + bombColor);
  specLabel.style('border-radius', '10px');
  specLabel.style('padding',       '3px 7px');
  specLabel.style('pointer-events','none');
  specLabel.parent(container);

  // "What sources are authoritative?" label
  let authLabel = createDiv('What sources are authoritative?');
  authLabel.style('position',      'absolute');
  authLabel.style('left',          authPct + '%');
  authLabel.style('top',           BOMB_LABEL_Y + 'px');
  authLabel.style('transform',     'translateX(-14px)');
  authLabel.style('font-size',     '11px');
  authLabel.style('font-weight',   '600');
  authLabel.style('color',         bombColor);
  authLabel.style('white-space',   'nowrap');
  authLabel.style('line-height',   '1');
  authLabel.style('background',    '#edf6f2');
  authLabel.style('border',        '1px solid ' + bombColor);
  authLabel.style('border-radius', '10px');
  authLabel.style('padding',       '3px 7px');
  authLabel.style('pointer-events','none');
  authLabel.parent(container);

  // "Did they catch him? (no)" label
  let catchLabel = createDiv('Did they catch him? (no)');
  catchLabel.style('position',      'absolute');
  catchLabel.style('left',          catchPct + '%');
  catchLabel.style('top',           WH_LABEL_Y + 'px');
  catchLabel.style('transform',     'translateX(-14px)');
  catchLabel.style('font-size',     '11px');
  catchLabel.style('font-weight',   '600');
  catchLabel.style('color',         bombColor);
  catchLabel.style('white-space',   'nowrap');
  catchLabel.style('line-height',   '1');
  catchLabel.style('background',    '#edf6f2');
  catchLabel.style('border',        '1px solid ' + bombColor);
  catchLabel.style('border-radius', '10px');
  catchLabel.style('padding',       '3px 7px');
  catchLabel.style('pointer-events','none');
  catchLabel.parent(container);

  // "Suspect images" label
  let imageLabel = createDiv('Suspect images');
  imageLabel.style('position',      'absolute');
  imageLabel.style('left',          imagePct + '%');
  imageLabel.style('top',           BOMB_LABEL_Y + 'px');
  imageLabel.style('transform',     'translateX(-14px)');
  imageLabel.style('font-size',     '11px');
  imageLabel.style('font-weight',   '600');
  imageLabel.style('color',         bombColor);
  imageLabel.style('white-space',   'nowrap');
  imageLabel.style('line-height',   '1');
  imageLabel.style('background',    '#edf6f2');
  imageLabel.style('border',        '1px solid ' + bombColor);
  imageLabel.style('border-radius', '10px');
  imageLabel.style('padding',       '3px 7px');
  imageLabel.style('pointer-events','none');
  imageLabel.parent(container);

  // "Suspect details" label
  let detailsLabel = createDiv('Suspects named');
  detailsLabel.style('position',      'absolute');
  detailsLabel.style('left',          detailsPct + '%');
  detailsLabel.style('top',           BOMB_LABEL_Y + 'px');
  detailsLabel.style('transform',     'translateX(-14px)');
  detailsLabel.style('font-size',     '11px');
  detailsLabel.style('font-weight',   '600');
  detailsLabel.style('color',         bombColor);
  detailsLabel.style('white-space',   'nowrap');
  detailsLabel.style('line-height',   '1');
  detailsLabel.style('background',    '#edf6f2');
  detailsLabel.style('border',        '1px solid ' + bombColor);
  detailsLabel.style('border-radius', '10px');
  detailsLabel.style('padding',       '3px 7px');
  detailsLabel.style('pointer-events','none');
  detailsLabel.parent(container);

  // "What details about them are relevant?" label — centered across all three revisions
  let relevantLabel = createDiv('What details about them are relevant?');
  relevantLabel.style('position',      'absolute');
  relevantLabel.style('left',          rel1Pct + '%');
  relevantLabel.style('top',           WH_LABEL_Y + 'px');
  relevantLabel.style('transform',     'translateX(-14px)');
  relevantLabel.style('font-size',     '11px');
  relevantLabel.style('font-weight',   '600');
  relevantLabel.style('color',         bombColor);
  relevantLabel.style('white-space',   'nowrap');
  relevantLabel.style('line-height',   '1');
  relevantLabel.style('background',    '#edf6f2');
  relevantLabel.style('border',        '1px solid ' + bombColor);
  relevantLabel.style('border-radius', '10px');
  relevantLabel.style('padding',       '3px 7px');
  relevantLabel.style('pointer-events','none');
  relevantLabel.parent(container);

  // Clamp relevantLabel so it doesn't extend past the right edge of the timeline
  setTimeout(() => {
    const containerW = container.elt.offsetWidth;
    const labelW     = relevantLabel.elt.offsetWidth;
    const leftPx    = rel1Pct / 100 * containerW;
    const rightEdge = leftPx - 14 + labelW;
    if (rightEdge > containerW) {
      relevantLabel.style('transform', 'translateX(' + Math.floor(containerW - leftPx - labelW) + 'px)');
    }

    // On narrow screens the timeline scrolls sideways — keep the current dot in view
    const scroller = select('#timeline-scroll').elt;
    const cur      = dotData.find(d => d.i === edit);
    if (cur && scroller.scrollWidth > scroller.clientWidth) {
      const x      = cur.pct / 100 * containerW;
      const margin = 40;
      if (x < scroller.scrollLeft + margin || x > scroller.scrollLeft + scroller.clientWidth - margin) {
        scroller.scrollLeft = x - scroller.clientWidth / 2;
      }
    }
  }, 0);
}
