# Discord Page Cues Skill

## When To Use
Use while observing Discord web pages.

## Goals
Classify DM, server, channel, login, permission, and composer states.

## Page Cues
Server list, channel list, message pane, and input box determine state.

## Research Moves
Only inspect visible content.

## Extraction Targets
Server, channel, user, visible message context.

## Action Recipes
Observe left navigation and composer before acting.

## Failure Cues
Login, permission denied, read-only, or unavailable server.

## Stop Conditions
Stop when channel identity is ambiguous.

## Output Requirements
Return concise page state.
