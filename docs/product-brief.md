# Product brief

> **How to use this template.** Fill every section before the first domain module is implemented.
> Delete the guidance in italics as you replace it. Anything still marked _TBD_ is an open decision
> that blocks implementation, not a detail to settle later. Keep this file current: the platform
> policies treat it as the source of truth for domain intent, alongside `project.manifest.yaml`.

## 1. Summary

_One paragraph: what this product is, who operates it, and what changes for them once it exists._

- **Product name:** _TBD_
- **Owner:** _TBD_
- **Last reviewed:** _YYYY-MM-DD_
- **Status:** _draft | in review | approved_

## 2. Problem

_What is broken today? Describe the current workflow, the cost of leaving it alone, and the
evidence you have. State the problem without naming a solution._

## 3. Users and roles

_Every role here must exist in `project.manifest.yaml` under `domain.roles` and be granted
permissions in `src/lib/server/auth/access-control.ts`._

| Role       | Who they are | What they must be able to do | What they must never do |
| ---------- | ------------ | ---------------------------- | ----------------------- |
| `admin`    | _TBD_        | _TBD_                        | _TBD_                   |
| `operator` | _TBD_        | _TBD_                        | _TBD_                   |
| `viewer`   | _TBD_        | _TBD_                        | _TBD_                   |

## 4. Success metrics

_How you will know it worked. Each metric needs a baseline and a target date; no metric may be a
count of shipped features._

| Metric | Baseline today | Target | Measured by | By when |
| ------ | -------------- | ------ | ----------- | ------- |
| _TBD_  | _TBD_          | _TBD_  | _TBD_       | _TBD_   |

## 5. Core flows

_One subsection per flow. Name the actor, the trigger, the steps, and the end state. These become
routes, services, and tests._

### Flow 1 — _name_

- **Actor:** _role_
- **Trigger:** _what starts it_
- **Steps:** _1. … 2. … 3. …_
- **End state:** _what is true afterwards_
- **Failure handling:** _what the user sees when a step fails_

## 6. Domain model

_The entities this product owns, mirrored in `project.manifest.yaml` under `domain.entities`.
One module per entity under `src/lib/server/modules/`._

| Entity | Bounded context | Key fields | Owned by | Notes |
| ------ | --------------- | ---------- | -------- | ----- |
| _TBD_  | `platform`      | _TBD_      | _TBD_    | _TBD_ |

## 7. Authorization matrix

_The permission each action requires. Every mutating route must appear here, and every row must be
enforced by a `requirePermission` call in a module policy._

| Action | Resource | Permission | admin | operator | viewer |
| ------ | -------- | ---------- | ----- | -------- | ------ |
| _TBD_  | _TBD_    | _TBD_      | ✅    | _TBD_    | ❌     |

## 8. Non-functional constraints

| Constraint    | Requirement | Notes                                      |
| ------------- | ----------- | ------------------------------------------ |
| Availability  | _TBD_       | _target uptime and maintenance windows_    |
| Latency       | _TBD_       | _p95 budget for the critical flow_         |
| Data volume   | _TBD_       | _expected rows and growth per month_       |
| Retention     | _TBD_       | _how long records and logs are kept_       |
| Compliance    | _TBD_       | _regimes that apply_                       |
| Locales       | _TBD_       | _must match `experience.supportedLocales`_ |
| Accessibility | _TBD_       | _target conformance level_                 |

## 9. Privacy and observability

_List the fields that are personal data. Every one of them must appear in
`observability.piiFields` in the manifest and must never reach a log line._

| Field | Why it is collected | Where it is stored | Retention |
| ----- | ------------------- | ------------------ | --------- |
| _TBD_ | _TBD_               | _TBD_              | _TBD_     |

## 10. Acceptance criteria

_Behavioural, testable statements. Each one should map to at least one test._

- [ ] _Given … when … then …_
- [ ] _Given … when … then …_

## 11. Out of scope

_What this release explicitly does not do, so the boundary is not renegotiated mid-build._

- _TBD_

## 12. Open questions and decisions

| Question | Owner | Needed by | Decision |
| -------- | ----- | --------- | -------- |
| _TBD_    | _TBD_ | _TBD_     | _TBD_    |
