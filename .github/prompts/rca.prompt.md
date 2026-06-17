---
description: "Run a full Root Cause Analysis for a rentacenter incident. Searches live GitHub code, cross-references DB data, reproduces calculations, and delivers a structured verdict."
---

# RCA Analysis

## Inputs needed
Provide as many of the following as you have:
- **Incident ID** (e.g. INCTEC1631355)
- **Agreement number(s)** affected
- **Module / screen** (e.g. "RAC Exchange", "payment", "agreement creation")
- **What the store/customer reported** (symptom)
- **Any DB query results** (paste screenshots or text — treated as ground truth)

---

## What this prompt does

Runs the full RCA workflow:

1. Maps the module to the correct GitHub repo (racpad_ / es_ / ess_ / sims_)
2. Searches the codebase for the relevant calculation, service, or component
3. Reads the actual code — no guessing
4. Reproduces every number using DB values you supply
5. Checks timing (created_date vs event timestamps) for race conditions
6. Delivers a verdict: **System Bug / Working as Designed / Process Gap / Data Issue**
7. Provides a concrete resolution
8. Cleans up all scratch files when you confirm the RCA is final

---

## Start

Begin the RCA for the following incident:

**Incident ID:** [INCIDENT_ID]
**Agreement(s):** [AGREEMENT_NUMBERS]
**Module:** [MODULE_NAME]
**Issue reported:** [DESCRIBE_THE_SYMPTOM]
**DB data available:** [PASTE_OR_DESCRIBE]
