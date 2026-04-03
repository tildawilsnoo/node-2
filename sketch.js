let data;
let edit = 0;
let currentText = '';
let currentDate = '';

function preload(){
  data = loadJSON('suspects_section_edits.json');
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

function prev() {
  edit--;
  currentText = data.edits[edit].edit_after;
  currentDate = data.edits[edit].time;
  select('#text').html(currentText);
  select('#time').html(currentDate);
  styleText();
}

function next() {
  edit++;
  currentText = data.edits[edit].edit_after;
  currentDate = data.edits[edit].time;
  select('#text').html(currentText);
  select('#time').html(currentDate);
  styleText();
}

function styleText() {
  let el = select('#text');
  let content = el.html();
  content = content.replace(/(##[^\n]+)/g, '<span class="title">$1</span> ');
  el.html(content);
}
