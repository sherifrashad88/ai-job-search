# Visa Job Desk (browser tool)

A no-install web page version of the job-search workflow, published as a claude.ai artifact:
https://claude.ai/artifact/LgymqvShxZ6tK6zC42AtBa

- `index.html`: the page (profile, check a job, application pack, tracker)
- `autofill.js`: the Autofill bookmark. The page builds it from the saved profile and the latest cover letter. It fills empty fields on company application forms, never overwrites typed text, never touches passwords or file uploads, never submits, and is switched off on LinkedIn and Indeed.
- `sponsor-check.js`: browser port of `tools/sponsor_lookup.py check-posting` and its Sponsor Strength score.
  It gives the same verdicts, quotes and scores as the Python tool (parity checked on 21 posting cases and 30 score cases).

It uses each viewer's own Claude account for scoring and drafts, and keeps each viewer's profile and
tracker private to them. Republish from this folder after editing both files.

The published page also carries three third-party libraries that are not copied here: `pdf.min.js` and `pdf.worker.min.js` (pdfjs-dist 3.11.174, Apache-2.0) and `mammoth.browser.min.js` (mammoth 1.8.0, BSD-2-Clause). They read uploaded PDF and Word CVs in the browser. Get them with `npm pack pdfjs-dist@3.11.174 mammoth@1.8.0`, and before publishing replace raw control bytes in the minified files with `\xNN` escapes: the artifact host refuses files containing them.
