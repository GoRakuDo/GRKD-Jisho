# Prompt Bucket Admin UI

## Status

Implemented and verified.

## Purpose

The Prompts page must support a shared default prompt plus two private output-bucket overrides:

- `daily-japanese`
- `indonesian`

The public/default clone should continue to work with one shared prompt. Bucket-specific prompts are an admin-only specialization layer.

## Goals

1. Make the default prompt obviously the baseline.
2. Make bucket overrides visible, but clearly secondary.
3. Keep the editor spacious and calm.
4. Prevent accidental edits to the wrong scope.
5. Preserve the current Astro + vanilla JS stack.

## Non-goals

- No framework migration.
- No React islands.
- No visual overdesign.
- No separate public prompt builder.

## Information Architecture

### Left rail: scope navigator

Three scope cards:

1. **Default Prompt**
   - Public baseline
   - Always present
   - Used when bucket override is missing

2. **Daily Japanese Override**
   - Private bucket override
   - Used when role routing resolves to `daily-japanese`

3. **Indonesian Override**
   - Private bucket override
   - Used when routing resolves to `indonesian`

Each card shows:

- active / inactive state
- whether it is inherited from default
- last saved timestamp
- version label

### Right surface: editor workspace

The main panel contains:

- scope title
- version selector
- editor textarea
- live preview
- template variables
- save / clone / activate actions

## Visual Direction

Use the current DESIGN.md language:

- royal blue as the primary action color
- OKLCH-only colors
- no pure black or white
- minimal, spacious, restrained surfaces
- thin borders instead of heavy shadows
- one accent family only

The page should feel like a control room, not a marketing page.

## Layout Proposal

### Desktop

- 2-column grid
  - left: 360–420px scope rail
  - right: flexible editor surface
- editor panel uses a horizontal split:
  - left: editable prompt text
  - right: live preview / resolved prompt contract
- template-variable help is collapsed by default

### Mobile

- single column
- scope cards stack first
- editor below
- preview collapses under the editor

## Component Set

### 1. PromptScopeCard

Shows one scope and its current state.

Fields:

- scope label
- badge: `Default`, `Override`, `Inherited`
- active version
- saved time
- action: `Edit`

### 2. PromptScopeSwitcher

Controls which scope is currently being edited.

### 3. PromptEditorShell

Contains the text editor, preview, and save actions.

### 4. PromptVersionList

Shows historical versions for the selected scope.

### 5. TemplateVariablesPanel

Lists only real variables:

- `{{role_key}}`
- `{{query}}`
- `{{reading}}`
- `{{dictionary_name}}`
- `{{definition_json}}`
- `{{prompt_version}}`

## Interaction Rules

1. Selecting a scope loads the latest version for that scope.
2. If no override exists, the UI shows the default prompt as inherited.
3. `Create New Version` duplicates the current scope version.
4. `Save` overwrites the selected version.
5. `Activate` sets the chosen version active for that scope only.
6. `Reset Override` clears bucket-specific overrides and falls back to default.

## Data Model Direction

Use one prompt table, but scope it.

Recommended fields:

- `scope_key` — `default` | `daily-japanese` | `indonesian`
- `version` — existing label system
- `content`
- `is_active`
- `updated_at`

Rules:

- `default` scope is the only public seed.
- bucket scopes are optional and private.
- runtime resolution tries bucket scope first, then default.

## Runtime Contract

The bot should resolve prompt content as:

1. selected output bucket prompt
2. fallback to default prompt

The cache key must include the resolved prompt content hash so bucket-specific edits invalidate only their own responses.

## Safety Notes

- No bucket prompt content should be exposed in public docs or seeds.
- The clone/export action should export only the default scope.
- Bucket-specific editing should require admin access only.

## Implementation Notes

1. Prompt schema now carries `scope_key`.
2. Scoped prompt services resolve bucket prompts with default fallback.
3. Bot prompt resolution selects per output bucket.
4. `prompts.astro` now uses a left scope rail and right editor workspace.
5. API routes now return scope views and support scoped reset.
6. Verified with typecheck, build, tests, and review.

## Acceptance Criteria

- Default prompt still works alone.
- Bucket-specific prompt editing works for both scopes.
- Default fallback is correct when no override exists.
- UI clearly separates public baseline and private overrides.
- No regression in existing prompt version editing.
