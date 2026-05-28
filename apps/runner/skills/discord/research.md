# Discord Research Skill

## When To Use
Use for web Discord servers, channels, conversations, and visible member context.

## Goals
Summarize accessible channels and save evidence visible to the logged-in account.

## Page Cues
`/channels/@me` indicates direct messages. Server/channel unavailable means permission issue.

## Research Moves
Inspect only servers and channels the account is already allowed to see.

## Extraction Targets
Server name, channel name, message context, username, and relevance reason.

## Action Recipes
Observe channel state and permissions before interacting.

## Failure Cues
Login screen, unavailable server, permission denied, read-only channel.

## Stop Conditions
Stop if the account is not joined to the needed server.

## Output Requirements
Save channel/source context and evidence.
