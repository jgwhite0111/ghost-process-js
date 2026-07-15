#!/usr/bin/env python3
"""Focused static regression checks for audit fix #15."""

import ast
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
PORTABLE_ROOT_SCRIPTS = (
    "bass_patch_sampler.py",
    "render_walking_bass_preview.py",
    "mix_minus_preview.py",
    "apply_bass_patch.py",
    "compose_walking_bass.py",
)


def parse(relative_path):
    path = ROOT / relative_path
    return ast.parse(path.read_text(), filename=str(path))


class AuditFix15StaticTests(unittest.TestCase):
    def test_make_scene_loop_has_no_medleys_assignment(self):
        tree = parse("tools/make_scene_loop.py")
        assigned_names = set()
        for node in ast.walk(tree):
            targets = []
            if isinstance(node, ast.Assign):
                targets = node.targets
            elif isinstance(node, ast.AnnAssign):
                targets = [node.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    assigned_names.add(target.id)
        self.assertNotIn("MEDLEYS", assigned_names)

    def test_intro_version_default_and_help_are_v11(self):
        path = TOOLS / "gen_intro_v2.py"
        tree = ast.parse(path.read_text(), filename=str(path))
        version_call = None
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not isinstance(node.func, ast.Attribute) or node.func.attr != "add_argument":
                continue
            if node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value == "version":
                version_call = node
                break
        if version_call is None:
            self.fail("version parser argument not found")
        keywords = {keyword.arg: keyword.value for keyword in version_call.keywords}
        self.assertEqual(ast.literal_eval(keywords["default"]), "v11")
        self.assertIn("default: v11", ast.literal_eval(keywords["help"]))

        usage = ast.get_docstring(tree) or ""
        self.assertIn("# v11 at 16:9 (default)", usage)
        self.assertIn("gen_intro_v2.py v11 16:9", usage)

        result = subprocess.run(
            [sys.executable, str(path), "--help"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("default: v11", result.stdout)
        self.assertNotIn("POST ", result.stdout + result.stderr)

    def test_utility_roots_derive_from_script_location(self):
        expected = "Path(__file__).resolve().parent.parent"
        for filename in PORTABLE_ROOT_SCRIPTS:
            with self.subTest(filename=filename):
                path = TOOLS / filename
                source = path.read_text()
                tree = ast.parse(source, filename=str(path))
                chdir_calls = [
                    node for node in ast.walk(tree)
                    if isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "os"
                    and node.func.attr == "chdir"
                ]
                self.assertEqual(len(chdir_calls), 1)
                self.assertEqual(ast.unparse(chdir_calls[0].args[0]), expected)
                self.assertNotIn("/Users/jwhite/ghost-process-js", source)

    def test_current_docs_and_runtime_comments_are_generic(self):
        for relative_path in ("README.md", "AGENTS.md"):
            with self.subTest(relative_path=relative_path):
                self.assertNotIn(
                    "/Users/jwhite/ghost-process-js",
                    (ROOT / relative_path).read_text(),
                )

        source = (ROOT / "src/runtime/music.js").read_text()
        comment_text = " ".join(
            line.lstrip().removeprefix("//").lstrip("*").strip()
            for line in source.splitlines()
            if line.lstrip().startswith(("//", "*"))
        )
        for stale_phrase in (
            "B-side",
            "A-side",
            "Both tracks",
            "track[1]",
            "third track in the medley",
            "Medleys with 3+ tracks are uncommon",
        ):
            with self.subTest(stale_phrase=stale_phrase):
                self.assertNotIn(stale_phrase, comment_text)
        for current_semantics in (
            "stored on each destination entry",
            "half the first track's known duration or 30 seconds",
            "crossfade overlaps for 4 seconds",
            "progression continues while another entry exists",
        ):
            with self.subTest(current_semantics=current_semantics):
                self.assertIn(current_semantics, comment_text)


if __name__ == "__main__":
    unittest.main()
