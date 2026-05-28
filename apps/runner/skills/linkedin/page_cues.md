# LinkedIn Page Cues Skill

## When To Use
Use while observing LinkedIn pages.

## Goals
Classify login, profile, search, messaging, and challenge states.

## Page Cues
`/feed/` is logged-in shell. `/in/` is profile. Checkpoint pages indicate blocked verification.

## Research Moves
Prefer visible profile data over inferred data.

## Extraction Targets
Profile name, headline, company, location, and activity signals.

## Action Recipes
Observe header and primary actions before acting.

## Failure Cues
Unavailable profile, auth wall, or identity mismatch.

## Stop Conditions
Stop on challenges.

## Output Requirements
Return concise page state.
