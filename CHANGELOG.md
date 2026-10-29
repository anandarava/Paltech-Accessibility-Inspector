# Changelog

All notable changes to PalTech Accessibility Testing. Versions follow [semantic versioning](https://semver.org/):

- **Patch** (2.0.0 → 2.0.1): bug fixes only.
- **Minor** (2.0.1 → 2.1.0): new features; nothing existing breaks.
- **Major** (2.x → 3.0.0): large changes, or changes to the report or JSON export format.

Each release is a `v<version>` tag on `main` with a GitHub Release. Development builds between releases show a `-beta` label (the manifest's `version_name`) in `chrome://extensions` and in exported reports.

---

## [2.0.0] – unreleased

### Added

### Changed

### Fixed

---

## [1.0.0] – 2026-10-28

First release shared with the team.

### Automated scan
- WCAG 2.2 A and AA scan with axe-core and PalTech's own rules (72 rules in [shared/a11y-rules.json](shared/a11y-rules.json)), with AAA mode.
- Needs review tab for results the checks can't decide; these don't count toward the score.
- Overlays on the page: issue highlights, tab order, headings, landmarks and accessible names.
- Keyboard test, Contrast checker with eyedropper, and colour-blindness simulation.
- Saved scans, scan comparison, baseline and ignore lists.

### Site scan
- Finds an application's pages and scans them one by one, in several windows at once.
- Rescan, search, and View to open a page with its issues; screenshots of every failed element.

### Manual assessment
- Quick Assess (10 checks) and Full Assessment (23 tests covering every WCAG 2.2 A and AA success criterion), with their own report.

### Reports
- HTML and JSON exports for single pages and site scans, saved as `<application name>_Accessibility_Report`.
- Summary with score, issues by severity, needs-review count and the scanned site's own logo; developer details with fixes, code locations and HTML.

### Docs
- README, RULES_GUIDE, USER_GUIDE, MODULE_API and USER_MANUAL (Markdown and PDF).

[2.0.0]: https://github.com/anandarava/Paltech-Accessibility-Inspector/compare/v1.0.0...main
[1.0.0]: https://github.com/anandarava/Paltech-Accessibility-Inspector/releases/tag/v1.0.0
