"""Tests for the transcript glossary post-pass (analyze/glossary.py).

Run from the project root:  python3 -m unittest discover -s tests
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

# analyze/ holds the module under test; add it to the path the same way the CLI does.
ANALYZE = Path(__file__).resolve().parent.parent / "analyze"
sys.path.insert(0, str(ANALYZE))

import glossary as g  # noqa: E402


def vtt(*cues: str) -> str:
    """Build a minimal WEBVTT doc, one cue per body string."""
    out = ["WEBVTT", ""]
    for i, body in enumerate(cues):
        start = f"00:00:{i*2:02d}.000"
        end = f"00:00:{i*2+1:02d}.000"
        out += [f"{start} --> {end}", body, ""]
    return "\n".join(out)


def body_lines(text: str) -> list[str]:
    """The cue body lines (everything that isn't header/NOTE/timestamp/blank)."""
    return [l for l in text.splitlines()
            if l.strip() and not l.startswith(("WEBVTT", "NOTE")) and "-->" not in l]


class TestDefaultGlossaryFile(unittest.TestCase):
    def test_loads_and_compiles(self):
        terms = g.load_glossary()
        self.assertTrue(terms, "default glossary.json should have terms")
        for t in terms:
            self.assertIn("canonical", t)
            self.assertTrue(t.get("variants"))
            g._compile(t)  # must compile without error


class TestUnambiguousReplacement(unittest.TestCase):
    def setUp(self):
        self.gloss = g.load_glossary()

    def fix(self, text):
        return g.apply_glossary(text, self.gloss)

    def test_stiiizy_variants(self):
        for variant in ("stizzy", "stisy", "steezy"):
            out = self.fix(vtt(f"I open the {variant} brand page."))
            self.assertIn("Stiiizy", out)
            self.assertNotIn(variant, out)

    def test_biotrack(self):
        out = self.fix(vtt("We reconcile against biotrac nightly."))
        self.assertIn("BioTrack", out)

    def test_myrcene(self):
        out = self.fix(vtt("The dominant terpene here is micrine."))
        self.assertIn("myrcene", out)
        self.assertNotIn("micrine", out)

    def test_multi_word_variant(self):
        out = self.fix(vtt("I log into this true to start the transfer."))
        self.assertIn("Distru", out)
        self.assertNotIn("this true", out)

    def test_case_insensitive_match(self):
        out = self.fix(vtt("STIZZY and Stizzy both appear here."))
        self.assertEqual(out.count("Stiiizy"), 2)


class TestContextGuards(unittest.TestCase):
    def setUp(self):
        self.gloss = g.load_glossary()

    def fix(self, text):
        return g.apply_glossary(text, self.gloss)

    def test_ease_not_replaced_in_plain_prose(self):
        out = self.fix(vtt("You can do this with ease, no trouble at all."))
        self.assertIn("with ease", out)
        self.assertNotIn("Eaze", out)

    def test_ease_replaced_in_domain_context(self):
        out = self.fix(vtt("I pull the order from the ease delivery menu."))
        self.assertIn("Eaze", out)

    def test_metric_not_replaced_in_plain_prose(self):
        out = self.fix(vtt("The key metric we track is conversion rate."))
        self.assertIn("metric", out)
        self.assertNotIn("METRC", out)

    def test_metric_replaced_in_compliance_context(self):
        out = self.fix(vtt("I push the manifest to metric for the transfer."))
        self.assertIn("METRC", out)

    def test_dispute_replaced_only_in_domain_context(self):
        plain = self.fix(vtt("The customer filed a dispute over the charge."))
        self.assertIn("dispute", plain)
        domain = self.fix(vtt("I sync inventory from dispute into the platform."))
        self.assertIn("Distru", domain)


class TestWordBoundarySafety(unittest.TestCase):
    def setUp(self):
        self.gloss = g.load_glossary()

    def fix(self, text):
        return g.apply_glossary(text, self.gloss)

    def test_substring_not_corrupted(self):
        # "ease" inside "increase"/"please", "metric" inside "metrics" — all left alone.
        text = vtt("Please increase the metrics dashboard size.")
        self.assertEqual(body_lines(self.fix(text)), body_lines(text))


class TestStructurePreserved(unittest.TestCase):
    def setUp(self):
        self.gloss = g.load_glossary()

    def test_timestamps_and_notes_untouched(self):
        text = "\n".join([
            "WEBVTT", "",
            "NOTE engine=parakeet model=parakeet-tdt this true metric",  # variants in a NOTE
            "",
            "00:00:01.000 --> 00:00:02.000",
            "I open this true and check metric for the manifest.",
            "",
        ])
        out = g.apply_glossary(text, self.gloss)
        lines = out.splitlines()
        self.assertIn("NOTE engine=parakeet model=parakeet-tdt this true metric", lines)
        self.assertIn("00:00:01.000 --> 00:00:02.000", lines)
        # The cue body, however, IS corrected.
        self.assertIn("Distru", out)
        self.assertIn("METRC", out)

    def test_trailing_newline_preserved(self):
        with_nl = vtt("plain text").rstrip("\n") + "\n"
        self.assertTrue(g.apply_glossary(with_nl, self.gloss).endswith("\n"))
        without_nl = vtt("plain text").rstrip("\n")
        self.assertFalse(g.apply_glossary(without_nl, self.gloss).endswith("\n"))


class TestIdempotency(unittest.TestCase):
    def test_second_pass_is_noop(self):
        gloss = g.load_glossary()
        once = g.apply_glossary(vtt("open this true, check micrine and stizzy"), gloss)
        twice = g.apply_glossary(once, gloss)
        self.assertEqual(once, twice)


class TestEdgeCases(unittest.TestCase):
    def test_empty_glossary_is_passthrough(self):
        text = vtt("this true metric stizzy")
        self.assertEqual(g.apply_glossary(text, []), text)

    def test_empty_text(self):
        self.assertEqual(g.apply_glossary("", g.load_glossary()), "")

    def test_custom_glossary_dict_list_form(self):
        terms = [{"canonical": "Foo", "variants": ["faux", "foe"]}]
        out = g.apply_glossary(vtt("a faux and a foe"), terms)
        self.assertEqual(out.count("Foo"), 2)


class TestApplyToFile(unittest.TestCase):
    def test_in_place_rewrite_and_count(self):
        gloss = g.load_glossary()
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "transcript.vtt"
            p.write_text(vtt("open this true", "plain unchanged line"), encoding="utf-8")
            changed = g.apply_to_file(p, gloss)
            self.assertEqual(changed, 1)
            self.assertIn("Distru", p.read_text())
            # Re-running changes nothing.
            self.assertEqual(g.apply_to_file(p, gloss), 0)


if __name__ == "__main__":
    unittest.main()
