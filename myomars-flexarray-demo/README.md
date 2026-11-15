# MyoMars FlexArray-MN · 45-second guided demo (package)

> Conceptual engineering design — not manufactured, clinically validated, or flight-qualified.
> Guided demo · synthetic data · not a clinical diagnosis.

This folder holds a portable, self-contained package of the **ASTRA FlexArray-MN V2.1** 45-second guided demonstration (MyoMars). It is a separate demo: nothing in the Next.js app, HUD, Station, Relay, contracts or `astra-patch/` uses it, and it uses none of them.

| File | What it is |
|---|---|
| `myomars-flexarray-45s-demo.zip` | The package: frontend source and prebuilt build, optional FastAPI backend, GLB models, docs and screenshots |
| `myomars-flexarray-45s-demo.zip.sha256` | SHA-256 checksum of the ZIP |
| `SOURCE.json` | Provenance: package checksum, size, contents and verification |

The ZIP is kept as one file on purpose. Its TypeScript sources would otherwise be picked up by this repository's root `tsconfig.json`, ESLint and `next build`.

## Run it

Requires **Node.js 18+** only. Python is needed only for the optional full ASTRA backend.

```bash
cd myomars-flexarray-demo
shasum -a 256 -c myomars-flexarray-45s-demo.zip.sha256   # Windows: Get-FileHash <zip> -Algorithm SHA256
unzip myomars-flexarray-45s-demo.zip -d /tmp/myomars-demo  # any folder outside this repository
cd /tmp/myomars-demo/myomars-flexarray-45s-demo
node start-demo.mjs
```

Open **http://127.0.0.1:8000/#flexarray** in Chrome or Edge and press **Start demo**. Unzip outside this repository so the extracted sources do not affect the root lint, typecheck or build.

The README inside the ZIP covers installation, the `--rebuild` and `--full` options, tests, the reviewer gate and known limitations.

## What the demo shows

| Time | Scene |
|---|---|
| 0:00–0:07 | Before EVA: Mars EVA preparation bay, fictional crew member A01 |
| 0:07–0:18 | FlexArray Technology: six-layer patch explodes; microneedle, sweat-management and electronics layers |
| 0:18–0:32 | AI Muscle Monitoring: simulated helmet HUD with synthetic sEMG and IMU. A left-quadriceps fatigue-related trend is flagged for review only when the existing MuscleSense demo rule triggers; it is labelled **Not a diagnosis**. |
| 0:32–0:45 | Mars Base Medical Review: evidence and baseline, then a **human reviewer gate** at 0:35. The demo stops until a person clicks **Confirm review as demo reviewer**, then shows a simulated retest instruction, crew acknowledgment and reassessment. |

## Safety and scope

- All astronaut data, telemetry, baselines and thresholds are **synthetic**. Demo limits are not NASA medical limits.
- The reviewer confirmation is **simulated**. It never confirms by itself, creates no authorization record, makes no network requests and writes nothing to storage.
- The retest instruction prescribes no treatment, medication or rest duration. Return-to-EVA decisions stay with the human medical team and mission control.
- RER is not used by the demo. In the ASTRA app it is information only and never triggers an abort alone.
- The package contains no credentials, `.env` files, databases or personal data.
