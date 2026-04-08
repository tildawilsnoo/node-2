let data;
let citationsRaw;
let citationMap = {};
let urlToCitationId = {};
let edit = 0;

function preload() {
  data = loadJSON('get citations/edits_with_citations.json');
  citationsRaw = loadJSON('get citations/citations.json');
}

function setup() {
  noCanvas();
  for (let c of citationsRaw.citations) {
    citationMap[c.citation_id] = c;
    if (c.url) {
      let normUrl = c.url.trim().replace(/\/$/, '');
      urlToCitationId[normUrl] = c.citation_id;
    }
  }
  showEdit();
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

  let html = e.changed_sections.map(name => {
    let section = e.section_text_after[name];
    let text = section ? wikitextToPlaintext(section.wikitext, e.citation_ids || []) : '';
    if (!text) return `<div class="section-block"><div class="section-removed">section removed</div></div>`;
    return `<div class="section-block">
      <div class="section-heading">${name}</div>
      <div class="section-body"><p>${text}</p></div>
    </div>`;
  }).join('');

  select('#text').html(html);
  styleText();
  renderReferences(e.citation_ids || []);
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
    if (!c) return `<li value="${i + 1}">${id}</li>`;

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

    return `<li id="ref-${i + 1}" value="${i + 1}">${parts.join(' ')}</li>`;
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

function findCitationId(refContent) {
  let urlMatch = refContent.match(/https?:\/\/\S+/);
  if (urlMatch) {
    let url = urlMatch[0].trim().replace(/[.,;'")\]]+$/, '').replace(/\/$/, '');
    return urlToCitationId[url] || null;
  }
  return null;
}

function wikitextToPlaintext(wikitext, citationIds) {
  citationIds = citationIds || [];

  // Extract <ref> content into placeholders before any cleanup strips the tags
  let placeholders = [];
  let text = wikitext.replace(/<ref\b[^>]*>([\s\S]*?)<\/ref>/gi, (_match, content) => {
    content = content.replace(/<!--[\s\S]*?-->/g, '').trim();
    let citId = findCitationId(content);
    if (!citId) return '';
    let idx = citationIds.indexOf(citId);
    if (idx === -1) return '';
    let num = idx + 1;
    let sup = `<sup class="reference"><a href="#ref-${num}"><span class="cite-bracket">&#91;</span>${num}<span class="cite-bracket">&#93;</span></a></sup>`;
    placeholders.push(sup);
    return `\x00CITREF${placeholders.length - 1}\x00`;
  });

  // Now do all cleanup (safe — placeholders contain no < > chars)
  text = text
    .replace(/<ref\b[^>]*\/>/gi, '')                  // remove self-closing <ref/>
    .replace(/<!--[\s\S]*?-->/g, '')                  // remove HTML comments
    .replace(/\{\{[^{}]*\}\}/g, '')                   // remove {{templates}}
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1') // [[Target|Label]] -> Label
    .replace(/'{2,3}([^']+)'{2,3}/g, '$1')            // ''italic''/'''bold''' -> text
    .replace(/<[^>]+>/g, '')                          // strip remaining HTML tags
    .replace(/thumb(?:nail)?\|(?:(?:right|left|center|\d+px)\|)?[^\n]*/gi, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\S+\s*\(talk\)\s*\d{2}:\d{2},\s*\d+\s+\w+\s+\d{4}\s*\(UTC\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Restore superscript HTML
  text = text.replace(/\x00CITREF(\d+)\x00/g, (_, i) => placeholders[+i]);
  return text;
}

function styleText() {
  selectAll('.section-body').forEach(el => {
    let content = el.html();
    content = content.replace(/(\n\s*){2,}/g, '</p><p>').replace(/\n/g, '<br>');
    el.html(content);
  });
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
