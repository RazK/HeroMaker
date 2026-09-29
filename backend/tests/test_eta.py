"""The 'time remaining' a user sees while Meshy builds their hero.

Measured on staging (2026-09-29): 3D modeling reported 6% after 55s, and the
old straight extrapolation told the user ~22 minutes; it finished two minutes
later. These pin the estimate to something a person can trust.
"""
from app.services.pipeline import estimate_total_seconds

MESHY_3D = 309  # configured estimate for meshy_3d, seconds


def test_early_low_progress_does_not_explode():
    total = estimate_total_seconds(elapsed=54.8, progress=6, configured=MESHY_3D)
    remaining = total - 54.8
    assert remaining < 6 * 60, remaining  # the old formula said ~14 min


def test_late_progress_follows_the_measured_pace():
    # 90% after 130s: the measurement dominates, not the 309s guess.
    total = estimate_total_seconds(elapsed=130, progress=90, configured=MESHY_3D)
    assert 140 <= total <= 180


def test_never_in_the_past():
    assert estimate_total_seconds(elapsed=500, progress=99, configured=60) > 500


def test_without_a_configured_estimate_it_extrapolates():
    assert estimate_total_seconds(elapsed=50, progress=50, configured=None) == 100
