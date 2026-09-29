---
id: liezamfo3z
kind: experiment
name: "sw-density-recall"
status: complete
created: 2026-09-22T10:00:00+01:00
from: "[[Slow-wave density on the retention night predicts overnight recall gain beyond]]"
tags: []
---

## Purpose

See whether slow-wave density on the retention night tracks how much recall improves by morning, and whether that survives holding encoding strength.

## Design

24 subjects, 40 word pairs each, tested at 22:00 and 07:30. Density is N3 slow waves per minute from the Fpz–Cz channel, artefacted epochs dropped.

Varied: nothing — density is observed, not manipulated. Held: list, cue order, lights-out time. Measured: recall gain as the percentage change in pairs recalled, with evening recall as the encoding covariate.

## Where it ran

repo: github.com/sleep-lab/sw-density
commit: 4f2ac1e
config: configs/recall-gain.yaml
out: /Users/lab/runs/sw-density/

## Artifacts

- ![[recall-vs-density.png]] — Recall gain against slow-wave density, one dot per subject.
- ![[per-subject.csv]] — Per-subject density, gain, and evening recall.
- bootstrap-draws.parquet — /Users/lab/runs/sw-density/bootstrap-draws.parquet · 2.4 GB · 2026-09-24 · Lab iMac · 2400000000:1790262000000:4f2ac1e9b0d3 — Every bootstrap draw behind the interval.

## Observations

The raw correlation is r = 0.41, but the interval runs from 0.01 to 0.70. With evening recall partialled out it holds at r = 0.36, so encoding strength does not explain it away.

The two highest-density subjects carry much of the slope; the bootstrap draws are on the lab machine.

## Position history

- 2026-09-25T11:00:00+01:00 · observations
  from:
- 2026-09-24T16:00:00+01:00 · design
  why: the first draft never said artefacted epochs are dropped, or which covariate stands for encoding
  from:
    24 subjects, 40 word pairs each, tested at 22:00 and 07:30. Density is N3 slow waves per minute from the Fpz–Cz channel.

    Varied: nothing — density is observed, not manipulated. Held: list, cue order, lights-out time. Measured: recall gain as the percentage change in pairs recalled.
- 2026-09-22T10:00:00+01:00 · design
  from:
