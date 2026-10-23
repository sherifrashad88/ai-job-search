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

# What tells doctor.py that Claude Code is here without being on PATH.
CLAUDE_SIGNALS = ("CLAUDE_CODE_EXECPATH", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")


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
        for signal in CLAUDE_SIGNALS:
            env.pop(signal, None)
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


class ClaudeCodeDetectionTests(unittest.TestCase):
    """The desktop app ships claude outside PATH (playbook section 6).

    Before this, `shutil.which("claude")` was the only check, so a friend who
    only ever opens the folder in Claude Desktop saw a MISSING line that no fix
    command could clear - and SOP-0 step 3 tells them to run doctor.py until no
    MISSING lines are left.
    """

    def stripped_env(self, **extra):
        env = dict(os.environ, PATH=os.path.dirname(sys.executable))
        for signal in CLAUDE_SIGNALS:
            env.pop(signal, None)
        env.update(extra)
        return env

    def claude_item(self, env):
        proc = run("--json", env=env)
        report = json.loads(proc.stdout)
        return next(i for i in report["tools"] if i["name"] == "Claude Code")

    def test_not_found_without_path_or_any_signal(self):
        if (Path(os.path.dirname(sys.executable)) / "claude").exists():
            self.skipTest("claude sits next to this interpreter")
        found = self.claude_item(self.stripped_env())
        self.assertFalse(found["ok"])
        self.assertEqual(found["detail"], "not found")

    def test_desktop_app_exec_path_counts(self):
        exe = Path(sys.executable)  # any real file: doctor only needs it to exist
        found = self.claude_item(self.stripped_env(CLAUDE_CODE_EXECPATH=str(exe)))
        self.assertTrue(found["ok"], "the desktop app's own binary must count")
        self.assertIn("desktop app", found["detail"])

    def test_exec_path_that_does_not_exist_is_ignored(self):
        env = self.stripped_env(CLAUDE_CODE_EXECPATH=str(REPO / "nonexistent" / "claude.exe"))
        if (Path(os.path.dirname(sys.executable)) / "claude").exists():
            self.skipTest("claude sits next to this interpreter")
        self.assertFalse(self.claude_item(env)["ok"], "a stale path must not pass the check")

    def test_running_inside_claude_code_counts(self):
        found = self.claude_item(self.stripped_env(CLAUDECODE="1"))
        self.assertTrue(found["ok"])
        self.assertIn("inside Claude Code", found["detail"])

    def test_entrypoint_alone_counts(self):
        found = self.claude_item(self.stripped_env(CLAUDE_CODE_ENTRYPOINT="claude-desktop"))
        self.assertTrue(found["ok"])

    def test_still_required_so_a_bare_machine_is_not_ready(self):
        item = next(i for i in json.loads(run("--json").stdout)["tools"] if i["name"] == "Claude Code")
        self.assertTrue(item["required"], "Claude Code stays a hard requirement")


if __name__ == "__main__":
    unittest.main()
