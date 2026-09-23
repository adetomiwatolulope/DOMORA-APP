---
name: pipeline-job-builder
description: Run this skill for anything that runs in a worker: pipeline stages, job types, queue processors, batch handling, or export.
---

# Pipeline Job Builder

## Trigger
Load this skill for:
- worker jobs;
- pipeline stages;
- queue processors;
- batch processing;
- export jobs.

## Purpose
Teach job granularity, the three cost gates in order before any AI spend, PARTIAL batch semantics, and the export stage's watermark and diagram edges.

## Required workflow

1. **Identify the job boundary.**
   - Make each job responsible for one coherent pipeline unit.
   - Do not mix unrelated business decisions into a worker merely because they run asynchronously.

2. **Run the three cost gates in order.**
   - Execute the project's three cost gates in their defined order before any AI spend.
   - A later gate must not be reached by bypassing an earlier gate.
   - If a gate blocks the job, stop before AI/provider work.

3. **Preserve PARTIAL semantics.**
   - Batch work must distinguish complete, failed, and PARTIAL outcomes according to the project contract.
   - Do not mark a partially processed batch as fully successful.

4. **Build exports from the defined stage boundary.**
   - Preserve the export stage's watermark behavior.
   - Preserve the required diagram edges between pipeline stages.
   - Do not invent a new export path that bypasses the defined pipeline.

5. **Make retries safe.**
   - Keep job effects bounded to the intended stage and batch.
   - Avoid duplicate writes when a worker is retried.

## Hard stops
- Do not spend on AI before the three cost gates have run in order.
- Do not collapse PARTIAL into success.
- Do not bypass the export watermark.
- Do not redraw pipeline dependencies by silently removing required diagram edges.

## Source trace
The worker/pipeline contract and its named cost gates, PARTIAL semantics, watermark, and diagram edges are supplied by the agreed project skill requirements. The PRD/AGENTS.md supplied in this chat also establishes that no AI/LLM integration ships in the MVP; therefore this skill must not be used to introduce AI into the MVP without an explicit later-phase decision.