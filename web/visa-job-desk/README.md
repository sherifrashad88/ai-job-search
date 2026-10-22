# Visa Job Desk (browser tool)

A no-install web page version of the job-search workflow, published as a claude.ai artifact:
https://claude.ai/artifact/LgymqvShxZ6tK6zC42AtBa

- `index.html`: the page (profile, check a job, application pack, tracker)
- `sponsor-check.js`: browser port of `tools/sponsor_lookup.py check-posting` and its Sponsor Strength score.
  It gives the same verdicts, quotes and scores as the Python tool (parity checked on 21 posting cases and 30 score cases).

It uses each viewer's own Claude account for scoring and drafts, and keeps each viewer's profile and
tracker private to them. Republish from this folder after editing both files.
