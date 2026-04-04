- make timeline
- make look nice
- make differences visible

what's most important? Visible differences? But I don't know how to do that in the correct way necessarily for animations? 

Still, working on making differences visible... 

PSUEDO PSUEDO CODE

For each section, use edit_diff instead of edit_after

Iterate over the edit_diff array
For each operation:
op: "insert" → wrap text in <span class="added">text</span>
op: "delete" → wrap text in <span class="deleted">text</span>
op: "equal" (if present) → plain text, no wrapping
Concatenate the spans in order by offset to reconstruct the full diff view

Apply the same newline → <br> / <p> formatting to the resulting HTML as you do now in styleText()

Add CSS


.added   { background-color: #ccffcc; }
.deleted { background-color: #ffcccc; text-decoration: line-through; }
Handle edit_after: null (whole section deleted) — you could show the deleted text in red with a strikethrough, or skip the section entirely