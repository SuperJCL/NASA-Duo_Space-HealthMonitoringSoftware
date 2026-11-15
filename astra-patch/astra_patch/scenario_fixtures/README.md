# MyoMars deterministic scenario fixtures

12 synthetic observation windows, 4 per scenario, every 6 seconds. These are internal CSV fixtures, **not** a public API schema or medical thresholds.

- normal: stable signal and good quality; base continues monitoring.
- fatigue_suspected: good-quality rising RMS and falling median frequency; base must review comparable baseline, context, and whether to recommend rest/retest.
- sensor_fault: scenario ground truth is normal, but electrode fault corrupts measured signals; base must identify poor quality, request patch check, and avoid a false fatigue conclusion.

The scenario and expected_classification columns are **test oracle metadata only**, never health evidence and never inputs for choosing the base's conclusion. The fixture contains synthetic summary features rather than raw EMG. Map permitted fields to the team's approved API contract when available. Do not send directly to HUD or auto-submit retests.

Acceptance: walking 6-second windows; pause prevents new observations; reset changes round ID and discards old queued transmissions; duplicates get idempotent acknowledgments. This package does not implement transport or claim live base integration.
