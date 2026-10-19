# ASL fingerspelling practice (research prototype)

Live: https://shadowcoder1.github.io/asl-fingerspelling-practice/

A webcam practice page for ASL fingerspelling handshapes: the letter's picture is drawn in the camera view for your
hand to fit into, a gold finger shows which finger to move and where, and the picture turns green when the handshape
is right. Hand tracking is Google's MediaPipe; the grader is a small statistical model fitted on public, openly
licensed hand-landmark datasets (attributions inside `tutor/model.json`), with OpenFS (KETI) as a second opinion on a
few letters, for non-commercial research. Everything runs in the browser and nothing is saved.

This teaches fingerspelling handshapes, not ASL. To learn ASL, learn from Deaf teachers. Grading is approximate and
can be wrong.

Options: `?letters=BLFG` (letters, in that order), `&hand=left`, `&srcmirror=1` (a camera that sends a mirror image).
Keys: G shows or hides the picture, N skips to the next letter.
