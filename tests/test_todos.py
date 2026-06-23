"""todos.py — intent classification + evidence attachment (heuristic core)."""
import sys
import unittest
from pathlib import Path

ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import todos  # noqa: E402


class TestClassify(unittest.TestCase):
    def test_explicit_todo(self):
        self.assertEqual(todos.classify("let's add that as a to-do"), "to-do")
        self.assertEqual(todos.classify("we need to fix the filter"), "to-do")

    def test_bug(self):
        self.assertEqual(todos.classify("that's a bug, it doesn't work"), "bug")
        self.assertEqual(todos.classify("this is broken"), "bug")

    def test_question_ends_with_qmark(self):
        self.assertEqual(todos.classify("how does this tool work?"), "question")

    def test_question_modal(self):
        self.assertEqual(todos.classify("should we add a filter here"), "question")
        self.assertEqual(todos.classify("can we export this list"), "question")

    def test_declarative_wh_is_not_a_question(self):
        # The precision fix: a sentence that merely starts with "what" isn't a question.
        self.assertIsNone(todos.classify("What they would have to do is come here"))

    def test_research_and_praise_and_decision(self):
        self.assertEqual(todos.classify("we should look into the caching"), "to-do")  # priority
        self.assertEqual(todos.classify("I want to investigate the caching"), "research")
        self.assertEqual(todos.classify("that's really nice"), "praise")
        self.assertEqual(todos.classify("let's go with the second option"), "decision")

    def test_chatter_unclassified(self):
        self.assertIsNone(todos.classify("okay so now I'm on the home page"))
        self.assertIsNone(todos.classify(""))


class TestExtract(unittest.TestCase):
    def test_attaches_evidence(self):
        speech = [{"t": 10000, "text": "we need to add a filter here"}]
        timeline = [{"kind": "click", "t": 9500, "selector": "#filter",
                     "ctx": {"name": "Filter button"}}]
        frames = [{"t": 10200, "file": "frames/0000010200.png"}]
        api = [{"_t": 9800, "request": {"method": "GET", "url": "https://x/api/leads"}}]
        out = todos.extract_todos(speech, timeline, frames, api)
        self.assertEqual(len(out), 1)
        td = out[0]
        self.assertEqual(td["type"], "to-do")
        self.assertEqual(td["evidence"]["element"], "Filter button")
        self.assertEqual(td["evidence"]["selector"], "#filter")
        self.assertEqual(td["evidence"]["frame"], "frames/0000010200.png")
        self.assertIn("/api/leads", td["evidence"]["endpoint"])

    def test_drops_chatter_keeps_intent(self):
        speech = [{"t": 0, "text": "okay I'm clicking around"},
                  {"t": 5000, "text": "that's a bug"}]
        out = todos.extract_todos(speech, [], [], [])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["type"], "bug")

    def test_evidence_window_excludes_far_events(self):
        speech = [{"t": 100000, "text": "we should fix this"}]
        timeline = [{"kind": "click", "t": 0, "selector": "#far"}]  # 100s away
        out = todos.extract_todos(speech, timeline, [], [])
        self.assertNotIn("selector", out[0]["evidence"])

    def test_robust_to_garbage(self):
        todos.extract_todos([None, {"text": 5}, {}], [None], None, None)  # must not raise


if __name__ == "__main__":
    unittest.main()
