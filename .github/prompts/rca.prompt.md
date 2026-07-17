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
- **Date the issue was first observed** (helps narrow down the introducing commit / release)
- **Environment** (Prod / UAT / QA) and **store number(s)** if known
- **Jira ticket ID** (if already raised by Dev/QA, e.g. RAC-4512 or FLX-321)
- **Recent release or deployment date** known to have happened around the time of the issue

---

## What this prompt does

Runs the full RCA workflow from a **Support team perspective**:

1. Maps the module to the correct GitHub repo (racpad_ / es_ / ess_ / sims_)
2. Searches the codebase for the relevant calculation, service, or component
3. Reads the actual code — no guessing
4. Reproduces every number using DB values you supply
5. Checks timing (created_date vs event timestamps) for race conditions
6. **Traces the introducing commit** — which code change, by whom, in which commit SHA
7. **Extracts the Jira ticket** — from the commit message or PR title (e.g. RAC-4512, FLX-321)
8. **Identifies the release / deployment** that carried the bad code to production
9. Delivers a verdict: **System Bug / Working as Designed / Process Gap / Data Issue**
10. Provides a concrete resolution with the commit/Jira/release chain for stakeholder communication
11. Cleans up all scratch files when you confirm the RCA is final

---

## Start

Begin the RCA for the following incident:

**Incident ID:** [INCIDENT_ID]
**Agreement(s) / PO(s):** [AGREEMENT_OR_PO_NUMBERS]
**Module:** [MODULE_NAME]
**Issue reported:** [DESCRIBE_THE_SYMPTOM]
**Date first observed:** [YYYY-MM-DD or approximate]
**Environment / Store:** [PROD/UAT/QA] — Store #[STORE_NUMBER]
**Jira (if known):** [JIRA_TICKET_ID or "Unknown"]
**Recent release (if known):** [RELEASE_DATE or sprint name, or "Unknown"]
**DB data available:** [PASTE_OR_DESCRIBE]
