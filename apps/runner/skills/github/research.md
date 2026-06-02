# GitHub Research Skill

## When To Use
Use for GitHub API-backed outreach research in research mode: repositories, organizations, creators/maintainers, contributors, issue participants, and likely users/adopters.

## Goals
Find companies/projects and the people connected to them with public GitHub evidence. Separate project/company targets from creator/maintainer targets and user/adopter targets.

## Page Cues
Prefer GitHub API evidence over rendered browsing. Useful public surfaces include repository metadata, README files, package manifests, CODEOWNERS, contributors, user/org profiles, issues, PRs, topics, languages, and code-search references.

## Research Moves
Search repositories for project/company discovery. Search issues and PRs for pain or buying-intent signals. Search code and dependency files for likely user/adopter signals. Enrich top repositories with README, topics, languages, contributors, profile metadata, package metadata, and contact-path clues.

## Extraction Targets
Save project/company, creator/maintainer, and user/adopter targets. Capture repo URL, owner, contributor profile, issue/code source URL, public contact paths, evidence text, score, and relevance reason.

## Action Recipes
Use public GitHub REST API calls first. Use `GITHUB_TOKEN` or `GH_TOKEN` when available for higher API limits, but keep unauthenticated public research possible.

## Failure Cues
Rate limits, private or deleted repositories, missing README/package files, unavailable code search, or profiles with no public contact path.

## Stop Conditions
Do not save targets without a source URL and evidence text. Do not infer a private email unless the contact path provenance is explicit.

## Output Requirements
Save filters, sources, project/company targets, creator/maintainer targets, user/adopter targets, public contact-path metadata, evidence, drafts, and exports.
