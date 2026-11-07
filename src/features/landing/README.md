# landing

The front page's two working parts.

- `PostingForm`: takes a posting, sends `POST /api/maps` with `{ text }`, and goes to `/map/[id]` when the response has `{ id }`. If the response has `{ error }` as a sentence, it shows that; otherwise a built-in message. Waiting shows real elapsed time, not fake progress.
- `SurveySheet`: the example map picture. Fixed example content, labelled as an example.
