# Final Pipeline Report

## 1. Project One-Line Summary

Motion gives timing. Audio NMF estimates source identity. New gesture timing drives resynthesis.

## 2. System Architecture

- `gesture_nmf/`: Python research package and algorithm source of truth.
- `web_backend/`: FastAPI server that creates sessions, runs Step 1 through Step 3 jobs, writes artifacts, and serves reports/audio.
- `src/`: React, TypeScript, and Vite frontend for presentation, live frame capture, progress, confidence, warnings, audio review, and export.
- `outputs/web_sessions/<session_id>/`: per-session artifact folders with metrics, audio, plot data, frame timestamps, and reports.
- Verified Demo Mode: deterministic fixture scenario runs with no camera permission required.
- Live Capture Mode: samples grayscale downsampled frames directly from the camera video element and sends frame matrices/timestamps to Python.
- Research/Debug Mode: expands timing diagnostics, nulls, warnings, and component/audio inspection.

## 3. Why The Project Changed Direction

The original flawed idea was to initialize `H[0]` with visual timing and assume component 0 would become the drum. That is not reliable. Visual timing says when an event occurs, but the spectral dictionary `W` says what sound is being modeled. In a full mix, frames around drum hits also contain bass, harmony, room energy, and other transients. NMF can move the visually timed energy into any component that lowers reconstruction error.

The current approach separates calibration, selection, contrastive extraction, and resynthesis:

- Step 2A runs a blind NMF candidate pool and selects components/groups by visual timing and event metrics.
- Step 2A compares the true visual prior against fake-prior best-of-many nulls using the same search procedure.
- Step 2B uses visual active/inactive structure for full-mix-only contrastive NMF.
- Visual-H initialization, synthetic templates, KL reconstruction, and component drift are diagnostic only.

## 4. Step 1 Pipeline

Step 1 validates visual/audio coupling on an isolated percussive stem:

- Capture or synthesize video frames.
- Convert to grayscale, downsample, and flatten frames into columns.
- Compute frame differences with preserved frame count so video represents motion, not hand appearance.
- Run video NMF on the motion matrix.
- Select, gate, normalize, and optionally transient-shape the visual activation.
- Extract isolated stem RMS/onset envelope.
- Resample visual activation to the audio frame rate.
- Use cross-correlation for lag alignment.
- Report Pearson correlation, DTW cost, lag, and permutation null percentile.

Step 1 proves that the motion activation can line up with isolated percussive timing in controlled fixtures. It does not produce `W_target`, does not train the Step 2 target dictionary, and does not prove full-mix separation.

## 5. Step 2A Pipeline

Step 2A uses only the full mix and visual timing:

- Compute a full-mix log-magnitude spectrogram.
- Run blind audio NMF across a grid of component counts and seeds.
- Score every component activation against the visual timing prior.
- Build compact component groups when event coverage improves.
- Evaluate aligned similarity, onset precision/recall/F1, DTW-derived behavior, energy concentration in active windows, and audio sanity.
- Reconstruct selected target/group and residual with ratio masks.
- Compare the real visual prior against circularly shifted, shuffled, or reversed fake priors under the same best-of-many selection search.

Step 2A proves, on controlled fixtures, that true visual timing can select NMF components/groups better than fake visual timing. It does not prove arbitrary single-channel source separation, and it does not treat lower KL as separation success.

## 6. Step 2B Pipeline

Step 2B is full-mix-only and does not use isolated target stems:

- Build visual active and inactive windows from the estimated visual activation.
- Learn a background dictionary from inactive full-mix frames.
- Fit the fixed background dictionary over the full mix.
- Estimate active-frame residual energy.
- Learn or initialize target dictionaries from residual structure.
- Refit background plus target with target activation constrained near visual-active windows.
- Reconstruct target and residual with a ratio mask.
- Compare true masks against shifted-mask null runs.

Step 2B tests whether visual active/inactive structure provides weak supervision for target extraction. It is expected to degrade in dense, co-rhythmic, or always-coactive scenarios.

## 7. Diagnostics

Diagnostics include:

- Visual-H initialization experiments.
- Synthetic `W` template checks.
- Component identity drift reporting.
- KL reconstruction values.

These are not primary evidence. Visual-H initialization can drift, synthetic templates do not establish the main claim, and KL only measures mixture reconstruction quality.

## 8. Step 3 Pipeline

Step 3 uses target identity from Step 2 and a new gesture:

- Use the selected/fixed target dictionary or target identity from Step 2.
- Capture or synthesize a new gesture.
- Extract the new visual activation with the same motion-first video path.
- Replace/refit the selected activation row.
- Compute `X_hat = W @ H_new`.
- Convert log magnitude back to linear magnitude.
- Resynthesize with phase or controlled test phase.
- Report new gesture correlation, old rhythm correlation, onset F1, output length, silence, finite values, and clipping.

Step 3 succeeds when the output follows the new gesture more than the old rhythm. Low-confidence Step 2 results make Step 3 unreliable.

## 9. Web App UX Flow

- Opening screen: explains the three steps and offers Verified Demo, Live Capture, and Research view.
- Step cards: Step 1, Step 2, and Step 3 remain visible as the main flow.
- Transport timeline: shows pending, running, complete, stale, and error status across Step 1, Step 2A, Step 2B, and Step 3.
- Recording row: shows idle, ready, recording, processing, complete, or error.
- Live capture panel: shows camera status, preview, motion meter, FPS, frame count, dropped frames, duration, and matrix shape.
- Confidence badges and warnings: shown as first-class outputs, not buried in debug data.
- Audio players: labeled by method and artifact, with current-playing feedback and download links.
- Export flow: session report, session JSON, metrics JSON, and zip bundle links.

## 10. Edge Cases And Confidence

The app reports warnings rather than hiding failure conditions:

- Weak, dense, or continuous motion.
- Unstable FPS or dropped frames.
- Missing camera permission.
- Too few inactive frames for Step 2B.
- Active windows covering too much of the timeline.
- Silent or clipped audio.
- Co-rhythmic distractor ambiguity.
- Dense hi-hat-like targets.
- Impossible always-coactive scenarios.
- Stale artifacts after scenario or input changes.
- Manual override results.

Confidence is downgraded by dense visual activity, no peaks, large groups, ambiguous candidates, outside-active target activation, silent output, clipped output, shifted/null controls that do not degrade, and manual override.

## 11. What Is Currently Proven

Proven on deterministic synthetic fixtures:

- Motion-first Step 1 coupling can align with isolated percussive timing.
- Step 2A can beat fake-prior best-of-many nulls in favorable scenarios.
- Step 2A group selection can improve event coverage when targets split.
- Step 2B can use full-mix active/inactive structure in favorable scenarios.
- Negative controls report low confidence in ambiguous or impossible cases.
- Step 3 fixed-W resynthesis can follow a new gesture in controlled fixtures.

Proven by web/backend tests:

- API health, fixtures, sessions, jobs, CORS preflight, reports, artifacts, exports, and missing audio handling.
- Frontend confidence badges, warning lists, disabled capture explanations, placeholder plots, processing overlay, audio artifact rendering, and backend-offline UI.

Not yet proven:

- Robust separation on arbitrary real commercial music.
- Reliable live-camera timing under all lighting, motion, and browser scheduling conditions.
- Automatic semantic labeling of drums without ambiguity.

## 12. How To Run

Backend:

```bash
python -m web_backend.run
```

Frontend:

```bash
npm install
npm run dev
```

Alternative frontend port:

```bash
npm run dev -- --host 127.0.0.1 --port 5174
```

Research tests:

```bash
pytest -q
python scripts/run_research_suite.py --scenario easy_sparse --skip-pytest
python scripts/run_research_suite.py --scenario impossible_always_coactive --skip-pytest
```

Frontend checks:

```bash
npm test
npm run build
```

## 13. Artifact Map

Global research artifacts:

- `outputs/metrics.json`
- `TEST_SUITE_REPORT.md`
- optional WAVs and plots under `outputs/`

Web session artifacts:

- `outputs/web_sessions/<session_id>/session.json`
- `step1_metrics.json`
- `step2a_metrics.json`
- `step2b_metrics.json`
- `step3_metrics.json`
- `visual_activation.json`
- `video_frame_timestamps.json`
- `captures/<step>_frames.json`
- `plots/step1_plot_data.json`
- `audio/original.wav`
- `audio/step2a_target.wav`
- `audio/step2a_residual.wav`
- `audio/step2b_target.wav`
- `audio/step2b_residual.wav`
- `audio/step3_new_target.wav`
- `audio/step3_residual_plus_new.wav`
- `report.md`
- `<session_id>.zip` export bundle

## 14. Final Presentation Script

1. Start the backend and frontend.
2. Open the app and confirm the backend badge is connected.
3. Choose `easy_sparse` and run Verified Demo Mode.
4. Show Step 1 correlation, lag, null percentile, and motion-first plot.
5. Open Step 2A and show true visual timing versus fake-prior nulls.
6. Open Step 2B and show active/inactive contrastive extraction metrics.
7. Play original, Step 2A target/residual, and Step 2B target/residual.
8. Show Diagnostics and state that visual-H initialization is diagnostic only.
9. Run Step 3 and compare new gesture correlation with old rhythm correlation.
10. Play the new target and residual plus new target.
11. Export the report and session bundle.
