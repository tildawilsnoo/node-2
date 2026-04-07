let data;
let edit = 0;

function preload() {
  data = loadJSON('get data/boston_marathon_bombing_suspect_edits.json');
}

function setup() {
  noCanvas();
  showEdit();
}

function keyPressed() {
  if (keyCode === RIGHT_ARROW && edit < data.revisions.length - 1) next();
  if (keyCode === LEFT_ARROW && edit > 0) prev();
}

function showEdit() {
  let e = data.revisions[edit];

  select('#wiki-link').attribute('href', `https://en.wikipedia.org/w/index.php?diff=${e.revid}`);
  select('#editor').html(e.user);
  select('#comment').html(cleanWikitext(e.comment));

  let formatted = formatDateTime(e.timestamp);
  select('#date').html(formatted.date);
  select('#time').html(formatted.time);

  let html = e.changed_sections.map(name => {
    let section = e.section_text_after[name];
    let text = section ? cleanPlaintext(section.plaintext) : '';
    if (!text) return `<div class="section-block"><div class="section-removed">section removed</div></div>`;
    return `<div class="section-block">
      <div class="section-heading">${name}</div>
      <div class="section-body"><p>${text}</p></div>
    </div>`;
  }).join('');

  select('#text').html(html);
  select('#section').html('');
  styleText();
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

function cleanPlaintext(text) {
  return text
    .replace(/thumb(?:nail)?\|(?:(?:right|left|center|\d+px)\|)?[^\n]*/gi, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
