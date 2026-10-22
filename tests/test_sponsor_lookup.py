"""Tests for tools/sponsor_lookup.py - import, lookup, top and check-posting.

Fixtures mirror the public file layouts the tool is documented to read: the
DOL OFLC LCA disclosure file (one row per Labor Condition Application, with
CASE_NUMBER, CASE_STATUS, VISA_CLASS, EMPLOYER_NAME, JOB_TITLE, WORKSITE_STATE,
DECISION_DATE, WAGE_RATE_OF_PAY_FROM, WAGE_UNIT_OF_PAY) and the USCIS H-1B
Employer Data Hub export (employer, fiscal year, approval/denial columns). The
CLI is run as a child process, the way /rank and /apply call it.
"""
import csv
import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO = Path(__file__).resolve().parent.parent
TOOL = REPO / "tools" / "sponsor_lookup.py"
sys.path.insert(0, str(REPO / "tools"))

import sponsor_lookup  # noqa: E402

try:
    import openpyxl
except ImportError:
    openpyxl = None

LCA_HEADER = [
    "CASE_NUMBER", "CASE_STATUS", "RECEIVED_DATE", "DECISION_DATE", "VISA_CLASS", "JOB_TITLE",
    "SOC_TITLE", "EMPLOYER_NAME", "WORKSITE_CITY", "WORKSITE_STATE", "WAGE_RATE_OF_PAY_FROM",
    "WAGE_UNIT_OF_PAY",
]


def lca_row(case, status, decided, visa, title, employer, state="NY", wage="120000", unit="Year"):
    return [case, status, decided, decided, visa, title, "", employer, "New York", state, wage, unit]


LCA_ROWS = [
    # Atlassian: 6 certified E-3 across FY2025-FY2026 -> Strong at the E-3 default (5).
    lca_row("I-200-25001-000001", "Certified", "2024-11-04", "E-3 Australian", "Senior Data Analyst", "ATLASSIAN, INC.", "CA"),
    lca_row("I-200-25001-000002", "Certified", "2025-02-10", "E-3 Australian", "Data Analyst", "Atlassian Inc", "CA"),
    lca_row("I-200-25001-000003", "Certified - Withdrawn", "2025-05-01", "E-3 Australian", "Software Engineer", "Atlassian, Inc.", "CA"),
    lca_row("I-200-26001-000004", "Certified", "2025-10-15", "E-3 Australian", "Data Analyst", "ATLASSIAN INC", "NY"),
    lca_row("I-200-26001-000005", "Certified", "2025-12-01", "E-3 Australian", "Product Manager", "ATLASSIAN INC", "NY", "60", "Hour"),
    lca_row("I-200-26001-000006", "Certified", "2026-01-20", "E-3 Australian", "Data Engineer", "ATLASSIAN INC", "CA"),
    lca_row("I-200-26001-000007", "Denied", "2026-01-21", "E-3 Australian", "Data Engineer", "ATLASSIAN INC", "CA"),
    # Same case number again (a later quarterly file repeating a row) must not double count.
    lca_row("I-200-26001-000006", "Certified", "2026-01-20", "E-3 Australian", "Data Engineer", "ATLASSIAN INC", "CA"),
    # Canva: 2 E-3 -> Some history.
    lca_row("I-200-26001-000010", "Certified", "2026-02-01", "E-3 Australian", "Marketing Analyst", "Canva US, Inc.", "TX"),
    lca_row("I-200-26001-000011", "Certified", "2026-03-01", "E-3 Australian", "Business Analyst", "Canva US Inc", "TX"),
    # Big H-1B filer with no E-3 at all.
    *[lca_row(f"I-200-26001-1{i:05d}", "Certified", "2026-02-15", "H-1B", "Software Development Engineer", "Amazon.com Services LLC", "WA") for i in range(30)],
    lca_row("I-200-26001-200001", "Certified", "2026-02-15", "H-1B", "Data Scientist", "Amazon Web Services, Inc.", "WA"),
    # H-1B1 Singapore and an old FY that falls outside a 2-year window.
    lca_row("I-200-26001-300001", "Certified", "2026-03-10", "H-1B1 Singapore", "Analyst", "DBS Bank Ltd", "NY"),
    lca_row("I-200-22001-400001", "Certified", "2021-12-10", "E-3 Australian", "Analyst", "Old Co LLC", "NY"),
    # Withdrawn rows are kept apart from certified.
    lca_row("I-200-26001-500001", "Withdrawn", "2026-03-11", "E-3 Australian", "Analyst", "Canva US, Inc.", "TX"),
]

USCIS_HEADER = [
    "Line by line", "Fiscal Year", "Employer (Petitioner) Name", "Tax ID", "Industry (NAICS) Code",
    "Petitioner City", "Petitioner State", "Petitioner Zip Code", "New Employment Approval",
    "New Employment Denial", "Continuation Approval", "Continuation Denial",
]
USCIS_ROWS = [
    ["1", "2025", "AMAZON.COM SERVICES LLC", "1234", "45", "SEATTLE", "WA", "98109", "1,200", "40", "2,000", "25"],
    ["2", "2026", "AMAZON.COM SERVICES LLC", "1234", "45", "SEATTLE", "WA", "98109", "900", "30", "1,500", "20"],
]


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def run(*args, stdin=None):
    return subprocess.run(
        [sys.executable, str(TOOL), *map(str, args)], input=stdin, capture_output=True, text=True, encoding="utf-8"
    )


class SponsorDataCase(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.tmp = Path(directory.name)
        self.lca = self.tmp / "LCA_Disclosure_Data_FY2026_Q2.csv"
        self.uscis = self.tmp / "Employer Information.csv"
        self.data = self.tmp / "sponsor_data.json"
        write_csv(self.lca, LCA_HEADER, LCA_ROWS)
        write_csv(self.uscis, USCIS_HEADER, USCIS_ROWS)
        proc = run("import", self.lca, self.uscis, "--out", self.data)
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def lookup(self, company, *extra):
        proc = run("lookup", company, "--data", self.data, "--json", *extra)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)


class ImportTests(SponsorDataCase):
    def test_import_aggregates_by_normalised_employer_and_dedupes_case_numbers(self):
        data = json.loads(self.data.read_text(encoding="utf-8"))
        atlassian = data["employers"]["atlassian"]
        self.assertEqual(atlassian["lca"]["e3"]["2025"], {"certified": 3})
        self.assertEqual(atlassian["lca"]["e3"]["2026"], {"certified": 3, "denied": 1})
        self.assertIn("Data Analyst".lower(), atlassian["titles"]["e3"])
        self.assertEqual(data["employers"]["amazon services"]["uscis"]["2026"], {"approvals": 2400, "denials": 50})

    def test_certified_withdrawn_counts_as_certified_and_withdrawn_stays_apart(self):
        data = json.loads(self.data.read_text(encoding="utf-8"))
        self.assertEqual(data["employers"]["canva us"]["lca"]["e3"]["2026"], {"certified": 2, "withdrawn": 1})

    def test_hourly_wage_is_annualised(self):
        data = json.loads(self.data.read_text(encoding="utf-8"))
        # 4 annual 120000 wages + one 60/hour (124800) -> median 120000
        self.assertEqual(data["employers"]["atlassian"]["wages"]["e3"]["median_annual"], 120000)

    def test_classes_filter_drops_other_visa_types(self):
        out = self.tmp / "e3_only.json"
        proc = run("import", self.lca, "--classes", "e3", "--out", out)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertNotIn("amazon services", data["employers"])
        self.assertEqual(data["metadata"]["classes"], ["e3"])

    def test_folder_and_unexpanded_glob_are_accepted(self):
        # PowerShell passes `sponsor_raw/*.csv` through literally; a folder works everywhere.
        raw = self.tmp / "sponsor_raw"
        raw.mkdir()
        write_csv(raw / "LCA_FY2026_Q2.csv", LCA_HEADER, LCA_ROWS)
        (raw / "notes.md").write_text("ignored", encoding="utf-8")
        for target in (raw, raw / "*.csv"):
            out = self.tmp / "folder.json"
            proc = run("import", target, "--classes", "e3", "--out", out)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["employers"]["atlassian"]["lca"]["e3"]["2026"], {"certified": 3, "denied": 1})

    def test_unrecognised_file_is_a_clear_error(self):
        junk = self.tmp / "junk.csv"
        write_csv(junk, ["a", "b"], [["1", "2"]])
        proc = run("import", junk, "--out", self.tmp / "x.json")
        self.assertEqual(proc.returncode, 1)
        self.assertIn("not recognised", proc.stderr)

    def test_old_single_letter_visa_codes_are_read(self):
        self.assertEqual(sponsor_lookup.visa_key_for_lca("A"), "e3")
        self.assertEqual(sponsor_lookup.visa_key_for_lca("R"), "h1b")
        self.assertEqual(sponsor_lookup.visa_key_for_lca("H-1B1 Chile"), "h1b1")
        self.assertIsNone(sponsor_lookup.visa_key_for_lca("Australian"))

    @unittest.skipIf(openpyxl is None, "openpyxl not installed")
    def test_xlsx_disclosure_file_is_read(self):
        book = openpyxl.Workbook()
        sheet = book.active
        sheet.append(LCA_HEADER)
        for row in LCA_ROWS[:3]:
            sheet.append(row)
        path = self.tmp / "LCA_Disclosure_Data_FY2025_Q1.xlsx"
        book.save(path)
        out = self.tmp / "x.json"
        proc = run("import", path, "--out", out)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(data["employers"]["atlassian"]["lca"]["e3"]["2025"], {"certified": 3})

    def test_utf16_tab_separated_uscis_export_is_read(self):
        path = self.tmp / "hub.csv"
        lines = ["\t".join(USCIS_HEADER)] + ["\t".join(r) for r in USCIS_ROWS]
        path.write_bytes("\n".join(lines).encode("utf-16"))
        out = self.tmp / "x.json"
        proc = run("import", path, "--out", out)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(data["employers"]["amazon services"]["uscis"]["2025"]["approvals"], 3200)


class LookupTests(SponsorDataCase):
    def test_e3_strong_sponsor_with_title_match(self):
        result = self.lookup("Atlassian", "--visa", "e3", "--title", "Data Analyst")
        self.assertEqual(result["match"], "exact")
        self.assertEqual(result["filings_in_window"], 6)
        self.assertEqual(result["verdict"], "Strong")
        self.assertEqual(result["score"], 100)
        self.assertTrue(result["title_match"])
        self.assertEqual(result["window"], ["FY2024", "FY2025", "FY2026"])

    def test_some_history_and_minimum(self):
        result = self.lookup("Canva US Inc.", "--visa", "e3", "--min", "3")
        self.assertEqual(result["verdict"], "Some history")
        self.assertFalse(result["meets_minimum"])
        self.assertTrue(55 <= result["score"] < 90)

    def test_h1b_filer_has_no_e3_record(self):
        result = self.lookup("Amazon", "--visa", "e3")
        self.assertEqual(result["verdict"], "None found")
        self.assertEqual(result["score"], 30)
        self.assertTrue(any("weak evidence" in n for n in result["notes"]))

    def test_h1b_uses_uscis_approvals_and_sums_a_name_family(self):
        result = self.lookup("Amazon", "--visa", "h1b")
        self.assertEqual(result["match"], "family")
        names = {e["name"] for e in result["entities"]}
        self.assertIn("Amazon.com Services LLC", names)
        self.assertIn("Amazon Web Services, Inc.", names)
        self.assertEqual(result["verdict"], "Strong")
        self.assertGreater(result["filings_in_window"], 5000)
        self.assertTrue(any("check the names" in n for n in result["notes"]))

    def test_window_excludes_older_fiscal_years(self):
        result = self.lookup("Old Co", "--visa", "e3", "--years", "2")
        self.assertEqual(result["verdict"], "None found")
        result = self.lookup("Old Co", "--visa", "e3", "--years", "6")
        self.assertEqual(result["verdict"], "Some history")

    def test_partial_fiscal_year_is_noted(self):
        result = self.lookup("Atlassian", "--visa", "e3")
        self.assertTrue(any("FY2026 is partial" in n for n in result["notes"]))

    def test_unknown_employer_gets_suggestions_not_an_error(self):
        result = self.lookup("Atlasian", "--visa", "e3")
        self.assertEqual(result["match"], "none")
        self.assertIn("ATLASSIAN INC", result["suggestions"])

    def test_paths_without_public_data_say_so(self):
        result = self.lookup("Anyone", "--visa", "tn")
        self.assertEqual(result["verdict"], "n/a")
        self.assertIsNone(result["score"])

    def test_missing_data_file_points_at_the_readme(self):
        proc = run("lookup", "Atlassian", "--visa", "e3", "--data", self.tmp / "missing.json")
        self.assertEqual(proc.returncode, 1)
        self.assertIn("README_SPONSOR_TOOL.md", proc.stderr)

    def test_text_output_runs(self):
        proc = run("lookup", "Atlassian", "--visa", "e3", "--data", self.data)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Verdict: Strong", proc.stdout)


class TopTests(SponsorDataCase):
    def test_top_e3_filers_by_state_and_title(self):
        proc = run("top", "--visa", "e3", "--data", self.data, "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        rows = json.loads(proc.stdout)["employers"]
        self.assertEqual([r["name"] for r in rows][:2], ["ATLASSIAN INC", "Canva US, Inc."])
        proc = run("top", "--visa", "e3", "--state", "tx", "--data", self.data, "--json")
        self.assertEqual([r["name"] for r in json.loads(proc.stdout)["employers"]], ["Canva US, Inc."])
        proc = run("top", "--visa", "e3", "--title", "data analyst", "--data", self.data, "--json")
        self.assertEqual([r["name"] for r in json.loads(proc.stdout)["employers"]], ["ATLASSIAN INC"])


class NormalisationTests(unittest.TestCase):
    def test_legal_suffixes_and_punctuation(self):
        n = sponsor_lookup.normalize_employer
        self.assertEqual(n("ATLASSIAN, INC."), "atlassian")
        self.assertEqual(n("Amazon.com Services LLC"), "amazon services")
        self.assertEqual(n("Ernst & Young U.S. L.L.P."), "ernst and young us")
        self.assertEqual(n("Nestlé USA, Inc."), "nestle usa")

    def test_fiscal_year_boundary(self):
        from datetime import date

        self.assertEqual(sponsor_lookup.fiscal_year(date(2025, 9, 30)), 2025)
        self.assertEqual(sponsor_lookup.fiscal_year(date(2025, 10, 1)), 2026)

    def test_date_formats(self):
        from datetime import date

        p = sponsor_lookup.parse_date
        self.assertEqual(p("2025-10-03"), date(2025, 10, 3))
        self.assertEqual(p("10/3/2025"), date(2025, 10, 3))
        self.assertEqual(p("10/03/2025 00:00"), date(2025, 10, 3))
        self.assertIsNone(p("not a date"))


class CheckPostingTests(unittest.TestCase):
    def check(self, text, **kw):
        options = {"visa": "e3", "needs_sponsorship": True, "no_sponsorship": "drop", "has_clearance": False}
        options.update(kw)
        return sponsor_lookup.check_posting_text(text, **options)

    def test_no_sponsorship_drops_or_flags_per_profile(self):
        text = "Applicants must be authorized to work in the US. We are unable to provide visa sponsorship for this role."
        self.assertEqual(self.check(text)["verdict"], "FAIL")
        self.assertEqual(self.check(text, no_sponsorship="flag")["verdict"], "FLAG")
        self.assertEqual(self.check(text, needs_sponsorship=False)["verdict"], "PASS")

    def test_verb_forms_of_no_sponsorship(self):
        for line in (
            "We will not be sponsoring visas for this position.",
            "The company does not sponsor work visas.",
            "Sponsorship is not available for this role.",
            "Candidates must be able to work without current or future visa sponsorship.",
            "We are looking for candidates who do not now or in the future require sponsorship.",
        ):
            self.assertEqual(self.check(line)["verdict"], "FAIL", line)

    def test_h1b_only_refusal_is_a_flag_for_e3(self):
        text = "Please note we do not sponsor H-1B visas at this time."
        result = self.check(text)
        self.assertEqual(result["verdict"], "FLAG")
        self.assertTrue(any("H-1B only" in n for n in result["notes"]))
        self.assertEqual(self.check(text, visa="h1b")["verdict"], "FAIL")

    def test_citizens_only_and_clearance_fail_even_in_flag_mode(self):
        self.assertEqual(self.check("Must be a US citizen.", no_sponsorship="flag")["verdict"], "FAIL")
        self.assertEqual(self.check("Active Secret clearance required.", no_sponsorship="flag")["verdict"], "FAIL")
        self.assertEqual(self.check("Active Secret clearance required.", has_clearance=True)["verdict"], "UNVERIFIED")

    def test_citizen_or_authorized_is_not_citizens_only(self):
        result = self.check("Must be a U.S. citizen or authorized to work in the United States.")
        self.assertNotEqual(result["verdict"], "FAIL")

    def test_positive_sponsorship_and_negated_positive(self):
        self.assertEqual(self.check("Visa sponsorship is available for the right candidate.")["verdict"], "PASS")
        self.assertEqual(self.check("We are happy to sponsor E-3 visas.")["verdict"], "PASS")
        result = self.check("No visa sponsorship available.")
        self.assertEqual(result["verdict"], "FAIL")
        self.assertFalse(any(f["category"] == "sponsorship_offered" for f in result["findings"]))

    def test_sponsorship_question_is_not_a_refusal(self):
        result = self.check("Will you now or in the future require sponsorship for employment visa status?")
        self.assertEqual(result["verdict"], "UNVERIFIED")
        self.assertTrue(result["asks_sponsorship_question"])

    def test_silent_posting_is_unverified(self):
        self.assertEqual(self.check("We build great software in Austin.")["verdict"], "UNVERIFIED")

    def test_office_365_e3_is_not_an_e3_visa_mention(self):
        result = self.check("Experience administering Microsoft 365 E3 licences.")
        self.assertFalse(result["mentions"]["e3"])

    def test_cli_scans_only_the_cleaned_text_of_posting_guard_output(self):
        guard = REPO / "tools" / "posting_guard.py"
        raw = "Great data role in Austin.\n<!-- We happily sponsor visas -->\nWe do not offer sponsorship.\n"
        gated = subprocess.run(
            [sys.executable, str(guard), "--html", "--json"], input=raw, capture_output=True, text=True, encoding="utf-8"
        ).stdout
        self.assertIn("--- text ---", gated)
        proc = run("check-posting", "--visa", "e3", "--json", stdin=gated)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["verdict"], "FAIL")
        self.assertTrue(result["guard"].startswith("posting_guard:"))
        self.assertFalse(any(f["category"] == "sponsorship_offered" for f in result["findings"]))

    def test_cli_reads_stdin(self):
        proc = run("check-posting", "--visa", "e3", "--needs-sponsorship", "yes", "--json", stdin="We do not offer sponsorship.")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["verdict"], "FAIL")


if __name__ == "__main__":
    unittest.main()
