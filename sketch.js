let data;
let edit = 0;

function preload() {
  data = loadJSON('suspects_section_edits_all.json');
}

function setup() {
  let y = data.edits[0].date.split('-')[0];
  data.edits = data.edits.filter(e => e.date >= `${y}-04-15` && e.date <= `${y}-05-19`);
  noCanvas();
  showEdit();
}

function keyPressed() {
  if (keyCode === RIGHT_ARROW && edit < data.edits.length - 1) next();
  if (keyCode === LEFT_ARROW && edit > 0) prev();
}

function showEdit() {
  let e = data.edits[edit];

  select('#wiki-link').attribute('href', `https://en.wikipedia.org/w/index.php?diff=${e.revid}`);
  select('#editor').html(e.user);
  select('#comment').html(cleanWikitext(e.edit_comment));

  let formatted = formatDateTime(e.date, e.time);
  select('#date').html(formatted.date);
  select('#time').html(formatted.time);

  let html = e.sections.map(s => {
    if (s.edit_after === null) {
      return `<div class="section-block"><div class="section-removed">section removed</div></div>`;
    }
    let heading = s.heading.replace(/^## /, '');
    let body = s.edit_after.replace(/^##[^\n]*\n?/, '').trimStart();
    return `<div class="section-block">
      <div class="section-heading">${heading}</div>
      <div class="section-body"><p>${body}</p></div>
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

function formatDateTime(date, time) {
  let dt = new Date(`${date}T${time}Z`);
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

function styleText() {
  selectAll('.section-body').forEach(el => {
    let content = el.html();
    content = content.replace(/(\n\s*){2,}/g, '</p><p>').replace(/\n/g, '<br>');
    el.html(content);
  });
}

function renderTimeline() {
  let timestamps = data.edits.map(e => new Date(`${e.date}T${e.time}Z`));
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
  for (let e of data.edits) {
    if (seenDays.has(e.date)) continue;
    seenDays.add(e.date);
    let midnight = new Date(`${e.date}T00:00:00Z`);
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

  // one dot per edit
  for (let i = 0; i < data.edits.length; i++) {
    let dot = createDiv('');
    dot.class(i === edit ? 'timeline-dot current' : 'timeline-dot');
    dot.style('left', toPct(timestamps[i]) + '%');
    dot.parent(container);

    let idx = i;
    dot.mousePressed(() => { edit = idx; showEdit(); });
  }
}
