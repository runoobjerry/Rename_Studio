import pytest

from app.rules.base import RuleContext
from app.rules.case import CaseRule


@pytest.mark.parametrize(("mode", "expected"), [
    ("capitalize_words", "Élan Du_Monde！ Encore Ici.TxT"),
    ("lower", "élan du_monde！ encore ici.TxT"),
    ("upper", "ÉLAN DU_MONDE！ ENCORE ICI.TxT"),
    ("invert", "ÉLan Du_Monde！ ENcore iCI.TxT"),
    ("capitalize_first", "Élan du_monde！ encore ici.TxT"),
    ("sentence", "Élan du_monde！ Encore ici.TxT"),
    ("none", "élAN dU_mONDE！ enCORE Ici.TxT"),
])
def test_converts_name_with_selected_mode(mode: str, expected: str) -> None:
    rule = CaseRule()
    config = rule.parse_config({"mode": mode})
    assert rule.apply("élAN dU_mONDE！ enCORE Ici.TxT", RuleContext("id", 0, 1), config) == expected


@pytest.mark.parametrize(("mode", "expected"), [
    ("capitalize_words", "01-PreVIEW. Next_WORD"),
    ("capitalize_first", "01-PreVIEW. next_WORD"),
    ("sentence", "01-PreVIEW. Next_WORD"),
])
def test_preserves_non_initial_letter_case(mode: str, expected: str) -> None:
    rule = CaseRule()
    config = rule.parse_config({"mode": mode, "preserve_case": True})
    assert rule.apply("01-preVIEW. next_WORD", RuleContext("id", 0, 1, is_directory=True), config) == expected


@pytest.mark.parametrize(("filename", "options", "expected"), [
    ("IPAD-cdrom_cd-c++.MP3", {"mode": "lower", "fragments": " iPad, ,CD, C++ "}, "iPad-cdrom_CD-C++.MP3"),
    ("strAße.TxT", {"mode": "upper", "fragments": "Straße"}, "Straße.TxT"),
    ("my_ipad.TxT", {"mode": "none", "fragments": "iPad"}, "my_iPad.TxT"),
])
def test_enforces_literal_fragments_after_conversion(
    filename: str, options: dict[str, object], expected: str,
) -> None:
    rule = CaseRule()
    assert rule.apply(filename, RuleContext("id", 0, 1), rule.parse_config(options)) == expected


@pytest.mark.parametrize(("filename", "is_directory", "options", "expected"), [
    ("RAW.Name.TxT", False, {"mode": "lower", "ignore_extension": False}, "raw.name.txt"),
    ("RAW.Name.TxT", False, {"mode": "none", "extension_case": "upper"}, "RAW.Name.TXT"),
    (
        "RAW.Name.TxT", False,
        {"mode": "upper", "ignore_extension": False, "fragments": "TxT", "extension_case": "lower"},
        "RAW.NAME.txt",
    ),
    ("NEW.FOLDER", True, {"mode": "lower", "extension_case": "upper"}, "new.folder"),
    (".PROFILE", False, {"mode": "lower", "extension_case": "upper"}, ".profile"),
])
def test_applies_extension_settings_to_files_with_a_final_suffix(
    filename: str, is_directory: bool, options: dict[str, object], expected: str,
) -> None:
    rule = CaseRule()
    context = RuleContext("id", 0, 1, is_directory=is_directory)
    assert rule.apply(filename, context, rule.parse_config(options)) == expected
