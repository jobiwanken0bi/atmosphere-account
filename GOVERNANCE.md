# Governance

Atmosphere Account is currently a maintainer-led open-source project. Joseph
Basser is the lead maintainer (`@jobiwanken0bi` on GitHub and `@joebasser.com`
on Tangled) and is responsible for releases, production operations, security
responses, and final compatibility decisions.

## Decisions

- Routine fixes and additive improvements are decided through pull-request
  review.
- Protocol, schema, security-boundary, and breaking compatibility changes should
  begin with a public design issue.
- Decisions favor user control, AT Protocol interoperability, least privilege,
  operational simplicity, and a credible migration path.
- Security reports and active incidents may be handled privately until a safe
  disclosure is possible.

The lead maintainer makes the final call when consensus is not available, and
should record the reasoning in the issue, pull request, documentation, or
release notes.

## Roles

Consistent contributors may be invited to triage issues or review areas where
they have demonstrated context. Commit access is granted deliberately and can be
removed when inactive or when needed to protect the project. Code ownership is
review routing, not exclusive control over an area.

## Forges and releases

GitHub is the canonical CI, advisory, and release-management surface. Tangled is
a first-class source mirror and contribution surface. Accepted commits are
mirrored so both `main` branches point to the same Git object. A release is not
considered complete until required checks pass and the deployed revision is
identified by its exact commit SHA.

This document should evolve as the contributor and maintainer community grows.
