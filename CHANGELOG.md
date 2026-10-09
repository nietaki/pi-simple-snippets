# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `piSimpleSnippets.expandOnCompletion` (off by default): accepting a snippet completion
  inserts the snippet's text instead of its `%name` marker, so you can read and edit it
  before submitting. Multiline values are inserted across lines with the cursor after them,
  surrounding text is preserved, and submit-time expansion keeps working unchanged.

## [0.1.2] - 2026-10-09

### Changed

- update package description to something that makes sense

## [0.1.1] - 2026-10-09

### Changed

- simplify an humanize the README a bit

## [0.1.0] - 2026-10-09

### Added

- Initial implementation of snippet expansion, autocomplete, and the optional `%`
  shortcut, configured under the `piSimpleSnippets` key of Pi settings.

[Unreleased]: https://github.com/nietaki/pi-simple-snippets/compare/v0.1.2...master

[0.1.2]: https://github.com/nietaki/pi-simple-snippets/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nietaki/pi-simple-snippets/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nietaki/pi-simple-snippets/releases/tag/v0.1.0
