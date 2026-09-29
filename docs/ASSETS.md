# Asset and dependency attribution

Current terrain, tree, ore, building and villager pixel artwork is generated
by this repository's TypeScript code and released with the project under MIT.
Screenshots in `docs/screenshots/` show that generated artwork and are also
project artifacts. No external sprite, map, font or audio asset is bundled.
The browser uses a system font fallback and has no audio yet.

JavaScript and Elixir dependencies are pinned in `web/package-lock.json` and
`server/mix.lock`; their individual licenses remain with their upstream
packages. KC3 is checked out by `scripts/setup-kc3.sh` from its pinned commit
into ignored `.toolchain/` and is not redistributed in this repository. Review
KC3's notice in that commit before packaging a runtime binary.

The setup script also checks out pinned `kmx_sort` and `runj` sources into
`.toolchain/`; their license notices must be included when distributing those
executables.
