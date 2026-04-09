let data;
let citationsRaw;
let citationMap = {};
let refNameToId = {};
let urlToId = {};
let rawRefToId = {};
let edit = 0;

// Canonical article section order (grouped by how they appeared in the article structure)
const SECTION_ORDER = [
  'Attackers',
  'Suspect',
  'Suspects',
  'Suspected perpetrators',
  'Perpetrators',
  'Suspect photos released',
  'Description and identification of suspects',
  'Identification of suspects: Dzhokhar and Tamerlan Tsarnaev',
  'Identification: Dzhokhar and Tamerlan Tsarnaev',
  'FBI releases images of suspects',
  'Saudi suspect detained',
  'False suspect',
  'False reports of arrests',
  'Error in suspect identification',
  'Wrong suspect identification',
  'People mistakenly identified as suspects',
  'Other people identified or arrested as suspects',
  'MIT shooting',
  'MIT Shooting',
  'MIT shooting and suspect arrest',
  'MIT shooting and arrest',
  'MIT shooting and Watertown incident',
  'MIT shooting and Watertown incidents',
  'Manhunt and capture',
  'Manhunt and captures',
  'Arrest',
  'Arrests',
  'Other arrests',
  'Other arrests and detentions',
  'Other people arrested',
  'Criminal proceedings',
  'Post-arrest',
  'Suspect Backgrounds',
  'Suspects background',
  "Suspects' background",
  "Suspects' family",
  'Criticism of manhunt',
  'Criticism of the manhunt',
  'Critical reactions to the manhunt',
];

function preload() {
  data = loadJSON('get citations/edits_with_citations.json');
  citationsRaw = loadJSON('get citations/citations.json');
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
    let text = wikitextToPlaintext(val.wikitext || '', cidToNumber);
    return { name, text };
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

    let venue = c.newspaper || c.work || c.publisher;
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
    .replace(/\{\{[^{}]*\}\}/g, '')                   // remove {{templates}}
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1') // [[Target|Label]] -> Label
    .replace(/'{2,3}([^']+)'{2,3}/g, '$1')            // ''italic''/'''bold''' -> text
    .replace(/<[^>]+>/g, '')                          // strip remaining HTML tags
    .replace(/thumb(?:nail)?\|(?:(?:right|left|center|\d+px)\|)?[^\n]*/gi, '')
    .replace(/\[https?:\/\/\S+\]/g, '')                   // remove bare [url] links (no title)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[\]/g, '')                                  // remove empty brackets left after URL removal
    .replace(/\[\d+\]/g, '')                               // strip legacy [N] citation markers
    .replace(/[^\s\x00]+\s*\(talk\)\s*\d{2}:\d{2},\s*\d+\s+\w+\s+\d{4}\s*\(UTC\)/g, '')
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
    content = content.replace(/>\n+</g, '><').replace(/(\n\s*){2,}/g, '</p><p>').replace(/\n/g, '<br>');
    el.html(content);
  });
}

function renderTimeline() {
  let start = new Date('2013-04-15T04:00:00Z'); // midnight EDT (UTC-4)
  let end   = new Date('2013-05-16T04:00:00Z'); // midnight EDT — gives May 15 a full day

  function toPct(t) {
    return (t - start) / (end - start) * 100;
  }

  let container = select('#timeline');
  container.html('');

  let track = createDiv('');
  track.class('timeline-track');
  track.parent(container);

  // one tick + label per day, April 15 – May 15
  let months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let d = new Date(start);
  let firstDay = true;
  while (d < end) {
    let pct = toPct(d);

    if (!firstDay) {
      let tick = createDiv('');
      tick.class('timeline-tick');
      tick.style('left', pct + '%');
      tick.parent(container);
    }
    firstDay = false;

    let dayNum = d.getUTCDate();
    let labelText = dayNum === 1 ? months[d.getUTCMonth()] : String(dayNum);
    let label = createDiv(labelText);
    label.class('timeline-day-label');
    label.style('left', pct + '%');
    label.parent(container);

    d = new Date(d.getTime() + 86400000);
  }

  // bomb marker — 2:49 PM EDT (UTC-4) on April 15
  let bombTime = new Date('2013-04-15T18:49:00Z');
  let bombMarker = createDiv('');
  bombMarker.class('timeline-event up');
  bombMarker.style('left', toPct(bombTime) + '%');
  bombMarker.parent(container);
  createDiv('bomb detonates').class('timeline-event-label').parent(bombMarker);

  // MIT shooting marker — 10:48 PM EDT (UTC-4) on April 18
  let mitTime = new Date('2013-04-19T02:48:00Z');
  let mitMarker = createDiv('');
  mitMarker.class('timeline-event down');
  mitMarker.style('left', toPct(mitTime) + '%');
  mitMarker.parent(container);
  createDiv('MIT shooting').class('timeline-event-label').parent(mitMarker);

  // arrest marker — 8:42 PM EDT (UTC-4) on April 19
  let arrestTime = new Date('2013-04-20T00:42:00Z');
  let arrestMarker = createDiv('');
  arrestMarker.class('timeline-event up');
  arrestMarker.style('left', toPct(arrestTime) + '%');
  arrestMarker.parent(container);
  createDiv('Tsarnaev arrested').class('timeline-event-label').parent(arrestMarker);

  // one dot per revision
  for (let i = 0; i < data.revisions.length; i++) {
    let t = new Date(data.revisions[i].timestamp);
    let pct = Math.max(0, Math.min(100, toPct(t)));
    let dot = createDiv('');
    dot.class(i === edit ? 'timeline-dot current' : 'timeline-dot');
    dot.style('left', pct + '%');
    dot.parent(container);

    let idx = i;
    dot.mousePressed(() => { edit = idx; showEdit(); });
  }
}
