let data;
let edit = 0;
let currentHeading = '';
let currentText = '';
let currentTime = '';
let currentDate = '';

function preload(){
  data = loadJSON('suspects_section_edits_all.json');
}

function setup() {
  // createCanvas(400, 400);

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
  currentHeading = data.edits[edit].sections[0].heading;
  currentText = data.edits[edit].sections[0].edit_after;
  currentTime = data.edits[edit].time;
  currentDate = data.edits[edit].date;
  select('#text').html(currentText);
  select('#time').html(currentTime);
  select('#date').html(currentDate);
  select('#section').html(currentHeading);
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

function styleText() {
  let el = select('#text');
  let content = el.html();
  content = content.replace(/(##[^\n]+)/g, '<span class="title">$1</span> ');
  el.html(content);
}
