let data;
let edit = 0;
let currentText = '';
let currentTime = '';
let currentDate = '';
let comment = '';
let editor = '';

function preload(){
  data = loadJSON('suspects_section_edits_all.json');
}

function setup() {
  noCanvas();
  showEdit();
}

function draw() {
  // background(220);
}

function keyPressed() {
  if (keyCode === RIGHT_ARROW) {
    next();
  }
  if (keyCode === LEFT_ARROW) {
    prev();
  }
}

function showEdit() {
  let sections = data.edits[edit].sections;
  console.log(edit, sections.map(s => ({ heading: s.heading, change_type: s.change_type, has_text: s.edit_after !== null })));
  console.log(data.edits[edit])
  currentTime = data.edits[edit].time;
  currentDate = data.edits[edit].date;
  comment = cleanWikitext(data.edits[edit].edit_comment);
  editor = data.edits[edit].user;

  let html = sections.map(s => {
    let heading = s.heading.replace(/^## /, '');
    let body = (s.edit_after || '').replace(/^##[^\n]*\n?/, '');
    return `<div class="section-block">
      <div class="section-heading">${heading}</div>
      <div class="section-body">${body}</div>
    </div>`;
  }).join('');

  select('#text').html(html);
  select('#section').html('');
 console.log(currentDate, currentTime);
  let formatted = formatDateTime(currentDate, currentTime);
  select('#time').html(formatted.time);
  select('#date').html(formatted.date);
  select('#editor').html(editor);
  select('#comment').html(comment);
  styleText();
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
    content = content.replace(/\n/g, '<br>');
    el.html(content);
  });
}

