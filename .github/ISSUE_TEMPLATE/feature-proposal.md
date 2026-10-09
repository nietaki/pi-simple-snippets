---
name: Feature Proposal
about: Propose a well-specified enhancement or new feature
title: "feat: "
labels: ["enhancement"]
assignees: ""
---

## 🎯 Context and Goal
<!-- What problem should be solved, for whom, and why? Include representative use cases,
     examples, or relevant links where they clarify the need. -->

## 🔍 Proposed Behavior
<!-- Describe what users should observe in the editor, the popup, and on submit. Include
     example prompts and their expanded result, popup contents, and any configuration
     changes. Avoid prescribing internal implementation details. -->

## 📐 Domain Language
<!-- Define new or changed terms such as marker, boundary, wrapper, token, escape shape, or
     generation. Note renamed or superseded terms. Write "None" if unchanged. -->

| Term or concept | Definition | Change |
|-----------------|------------|--------|
|                 |            | New / changed / superseded |

## 📐 Invariants to Preserve
<!-- Which documented guarantees must keep holding: completion and expansion agreeing about
     what a token is, unknown markers staying literal, non-recursive one-pass expansion,
     the popup remaining Pi's native one, the shortcut acting only while the editor owns
     focus, and "nothing configured means nothing registered". Omit if none apply. -->

## ✅ Scope and Constraints

### In scope
<!-- Externally observable changes included in the proposal. -->

### Out of scope
<!-- Plausible adjacent capabilities deliberately excluded. -->

### Constraints
<!-- Requirements every acceptable implementation must preserve: settings-namespace
     compatibility with existing user configs, Pi host packages staying unbundled, no new
     runtime dependency without justification, and no additional Pi-internal assumption
     unless a documented API cannot provide the behavior. -->

## 🔀 High-Level Approach
<!-- Design decisions needed to prevent incompatible interpretations, without breaking the
     work into implementation tasks. Mention alternatives and trade-offs only where they
     help explain or constrain the chosen approach. -->

## ❓ Open Questions
<!-- Unresolved decisions, marked as blocking or not. Write "None" if resolved. -->

- None.

## 🏁 Acceptance and Validation

### Feature acceptance
<!-- Externally observable outcomes that establish correct implementation. -->

- [ ]

### Baseline completion checks
<!-- A starting checklist, not an exhaustive Definition of Done. -->

- [ ] New behavior and important failure cases are covered by tests.
- [ ] Any mirrored or inferred Pi-internal assumption is pinned in
      `test/pi-compatibility.test.ts` and commented where it is used.
- [ ] `npm run check` passes.
- [ ] `docs/behavior.md` is updated; `README.md` is updated when adoption, configuration,
      capabilities, or the initial experience change.
- [ ] `npm pack --dry-run` still ships only the intended files.
