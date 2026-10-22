"""Tests for tools/doctor.py - the fresh-install readiness check.

Run as a child process, the way the installer scripts call it. The check must
report every required tool with a fix hint, exit 0 only when every required
item passes, and never crash on a host that lacks a tool (CI runners have no
LaTeX).
"""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TOOL = REPO / "tools" / "doctor.py"
sys.path.insert(0, str(REPO / "tools"))

import doctor  # noqa: E402


def run(*args, env=None):
    return subprocess.run(
        [sys.executable, str(TOOL), *args], capture_output=True, text=True, encoding="utf-8", env=env
    )


class DoctorTests(unittest.TestCase):
    def test_json_report_shape_and_exit_code_agree(self):
        proc = run("--json")
        report = json.loads(proc.stdout)
        names = {i["name"] for i in report["tools"]}
        for required in ("Python 3.10+", "Git", "Claude Code", "Bun (job-board search tools)", "LaTeX: lualatex", "LaTeX: xelatex"):
            self.assertIn(required, names)
        required_ok = all(i["ok"] for i in report["tools"] + report["workspace"] if i["required"])
        self.assertEqual(report["ready"], required_ok)
        self.assertEqual(proc.returncode, 0 if required_ok else 1)
        for i in report["tools"] + report["workspace"]:
            if not i["ok"]:
                self.assertTrue(i["fix"], f"{i['name']} fails without a fix hint")

    def test_missing_tools_are_reported_not_a_crash(self):
        env = dict(os.environ, PATH=os.path.dirname(sys.executable), HOME=str(REPO / "nonexistent-home"))
        env.pop("JSEARCH_API_TOKEN", None)
        proc = run("--json", env=env)
        report = json.loads(proc.stdout)
        by_name = {i["name"]: i for i in report["tools"]}
        if not (Path(os.path.dirname(sys.executable)) / "claude").exists():
            self.assertFalse(by_name["Claude Code"]["ok"], "claude is not on the stripped PATH")
            self.assertFalse(report["ready"])
            self.assertEqual(proc.returncode, 1)
        self.assertIn("claude.ai/install", by_name["Claude Code"]["fix"])
        jsearch = next(i for i in report["workspace"] if i["name"].startswith("JSearch"))
        self.assertFalse(jsearch["ok"])
        self.assertFalse(jsearch["required"], "the JSearch key is optional")

    def test_text_output_runs(self):
        proc = run()
        self.assertIn("Software", proc.stdout)
        self.assertIn("Your workspace", proc.stdout)

    def test_every_hint_has_an_entry_for_each_os(self):
        for key, per_os in doctor.HINTS.items():
            self.assertEqual(set(per_os), {"Darwin", "Windows", "Linux"}, key)

    def test_template_profile_counts_as_not_set_up(self):
        report = json.loads(run("--json").stdout)
        profile = next(i for i in report["workspace"] if i["name"].startswith("Profile"))
        if "[YOUR_NAME]" in (REPO / "CLAUDE.md").read_text(encoding="utf-8"):
            self.assertFalse(profile["ok"])
            self.assertIn("placeholder", profile["detail"])


if __name__ == "__main__":
    unittest.main()
