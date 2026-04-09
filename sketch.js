let data;
let citationsRaw;
let citationMap = {};
let refNameToId = {};
let urlToId = {};
let rawRefToId = {};
let edit = 0;

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

  let citationIds = e.citation_ids || [];
  let cidToNumber = {};
  citationIds.forEach((cid, i) => { cidToNumber[cid] = i + 1; });

  let sections = e.changed_sections.map(name => {
    let section = e.section_text_after[name];
    let text = section ? wikitextToPlaintext(section.wikitext, cidToNumber) : '';
    return { name, text };
  });

  let hasAnyText = sections.some(s => s.text);

  let html = sections.map(({ name, text }) => {
    if (!text) {
      if (hasAnyText) return '';
      return `<div class="section-block"><div class="section-removed">section removed</div></div>`;
    }
    return `<div class="section-block">
      <div class="section-heading">${name}</div>
      <div class="section-body"><p>${text}</p></div>
    </div>`;
  }).join('');

  select('#text').html(html);
  styleText();
  renderReferences(citationIds);
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
    let nameMatch = attrs.match(/name\s*=\s*["']?([^"'>/\s]+)["']?/i);
    let refName = nameMatch ? nameMatch[1] : null;
    let cid = refName ? refNameToId[refName] : null;
    if (!cid) {
      let urlMatch = content.match(/https?:\/\/[^\s|"'\]}>]+/);
      if (urlMatch) cid = urlToId[urlMatch[0].trim().replace(/\/$/, '')];
    }
    if (!cid) {
      cid = rawRefToId[content.replace(/<!--[\s\S]*?-->/g, '').trim()];
    }
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
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[\d+\]/g, '')                               // strip legacy [N] citation markers
    .replace(/[^\s\x00]+\s*\(talk\)\s*\d{2}:\d{2},\s*\d+\s+\w+\s+\d{4}\s*\(UTC\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Restore superscript HTML from placeholders
  return text.replace(/\x00CITE(\d+)\x00/g, (_, i) => placeholders[+i]);
}

function styleText() {
  selectAll('.section-body').forEach(el => {
    let content = el.html();
    content = content.replace(/(\n\s*){2,}/g, '</p><p>').replace(/\n/g, '<br>');
    el.html(content);
  });
}

function renderTimeline() {
  let start = new Date('2013-04-15T00:00:00Z');
  let end   = new Date('2013-05-16T00:00:00Z'); // exclusive — gives May 15 a full day

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
