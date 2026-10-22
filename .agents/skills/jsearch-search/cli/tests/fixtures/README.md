# JSearch fixtures

These responses are **synthetic**. They were written by hand from JSearch's
documented response shape (the `{status, request_id, parameters, data}` envelope
and the `job_*` / `employer_*` / `apply_options` field names - see
`../../../url-reference.md`), not captured from the live API: the key-gated API
was not reachable when this skill was built, and a captured response would also
carry real third-party postings.

- Employers (Contoso, Fabrikam, Northwind, Tailspin) are fictional placeholder
  names; every link uses a reserved `.example` domain or an `example.*` host.
- Rows deliberately vary in shape - missing `job_location`, missing apply link
  with only `apply_options`, null date, entity-encoded title, hourly salary,
  a row with no `job_id` - so the normaliser's null handling is exercised.
- No credential appears anywhere; tests use an obviously fake token.

The tests serve these over loopback and redirect only the two JSearch API hosts
to that server in a child process; they make no network requests. When a live
capture becomes possible, replace these with a trimmed real response and note
its date here.
