# Quest and reward model

An event contains quests. Each quest has a globally unique slug in V0.1 and any number of reward definitions. Player identity is independent of events, quest URLs, and browser sessions. Future events add rows without replacing player records.

| Entity | States and meaning |
| --- | --- |
| Participation absent | Player has not entered the quest |
| ACTIVE | Player entered; staff have not confirmed completion |
| COMPLETED | Staff confirmed completion |
| ELIGIBLE reward | Completed player qualifies for consideration |
| SELECTED reward | Staff chose the player for glass |
| FULFILLED reward | Staff confirmed the physical handoff |

The seed creates **As Above So Below 2026**, quest **As Above So Below** at slug `as-above-so-below`, and **Glass artwork giveaway**. Intro text and an optional video URL live on the quest row. Future automated selection, other reward types, inventory management, and physical gameplay are outside V0.1.

## Corrections

Quest correction requires a reason, returns a completed participation to ACTIVE, and suspends its non-fulfilled rewards. Their previous reward status remains visible but no forward action is permitted while suspended. Recompletion restores suspended non-fulfilled rewards to ELIGIBLE; previous selection must be reconsidered rather than silently restored.

A mistaken selection can be corrected from SELECTED to ELIGIBLE with a reason. If already suspended, it stays suspended. Current selection/completion timestamps may be cleared when their state is corrected; the original action and correction remain in immutable history, preserving those past facts.

FULFILLED never reverses. A reward correction at that point writes an exception with operator, reason, and timestamp. Correcting a quest with fulfilled glass records fulfilled reward IDs in the correction's exception details and leaves those entitlements unchanged. This records discrepancies without claiming that the physical object was returned.

## Histories

`quest_events` records enrollment and lifecycle events. `operator_actions` records staff actions, self-reported identity, reason, request ID, and transition details. Both are append-only through database triggers. Successful state mutations append histories atomically; retries of the same request do not duplicate them. A redundant completion or reward transition with a fresh request ID is a no-op and creates no second lifecycle entry.

Staff verify nickname, Player ID, and reward state and explicitly confirm handoff. The model guarantees at most one fulfillment per entitlement; it does not establish that separate accounts belong to separate people or impose giveaway inventory limits.
