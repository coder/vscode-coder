# Windows ACL interface comparison

Experimental only. Neither prototype is connected to extension activation or the
SSH writer. Do not apply these prototypes to real user config directories.

## Scope

Compare a Rust executable against a Rust Node-API addon using interchangeable Win32 cores.
The intended distribution remains one universal VSIX containing Windows x64 and
ARM64 assets. Linux/macOS return before resolving, loading, or executing native
code. Native Windows builds are separate from VSIX packaging; platform-specific
Marketplace releases are not required.

- `core`: direct `windows-sys` ACL operations on an existing file or directory.
- `core-windows`: Microsoft `windows` typed bindings with the same ACL policy.
- `experiment.cjs` / `experiment-report.cjs`: isolated builds, runtime checks, PE
  import inspection, and universal package comparisons.
- `helper`: process interface with a versioned JSON response.
- `addon`: Node-API 8 interface using `napi-rs`, with work off the JS thread.
- `bridge.cjs`: lazy, Windows-only selection and error propagation.
- `stage.cjs`: copies build products into the explicit artifact layout.
- `package-prototype.cjs`: assembles an inert, independently named universal VSIX
  for one variant. Both Windows architectures must exist. No native downloads
  or installation scripts run for extension users.

The two experimental VSIXs are alternatives for comparison, not separate
platform releases. A selected production implementation would ship only one
variant, with both Windows architectures in the same universal extension.

## Results on September 14, 2026

Measured at commit `29de7d9` using Rust 1.98.1. Prototype Actions run
`34840561914` and standard repository CI run `34840562010` both passed.

- All six configurations built helper/addon payloads on native Windows x64 and
  ARM64 and passed the shared OpenSSH rejection/repair/rewrite, idempotence, and
  final-junction rejection tests under Node 22 and Electron 37/42.
- Both cores' Rust tests passed. The typed core still needs the low-level core's
  independent exact-ACE and directory-inheritance assertions before adoption.
- Linux/macOS bridge-bypass jobs and all twelve real universal VSIX archive
  inspections passed. Inert package activation is not a full editor integration test.
- PE import inspection covered both interfaces and architectures in every cell.

### Universal package size

Each experimental package contains x64 and ARM64 assets for one interface.
These are compressed prototype sizes, not production extension sizes.

| Configuration                     | Helper (KiB) | Addon (KiB) |
| --------------------------------- | -----------: | ----------: |
| Original manual ACL, opt 3        |        190.7 |       246.6 |
| Low-level SDDL, opt 3             |        194.2 |       250.1 |
| Low-level SDDL, opt s             |        160.5 |       231.1 |
| Microsoft `windows` + SDDL, opt s |        160.9 |       231.7 |
| Low-level SDDL, opt z             |        159.5 |       223.0 |
| Low-level SDDL, opt s, static CRT |        254.7 |       320.4 |

All cells use LTO, one codegen unit, stripping, and unwind panic strategy. The
original source at `22a751efc2fc859641e387921e115d01829db1ac` was rebuilt on the
same runners. At equal opt s, typed bindings add only 380 helper package bytes
and 693 addon package bytes. Size reductions versus original include compiler
optimization changes; they are not solely a dependency benefit. No latency
distributions were measured.

### Handwritten Rust and dependency maintenance

Counts include production-core comments/blanks and exclude the line containing
its first `#[cfg(test)]` and everything after it. Unsafe-token counts are rough
indicators, not safety scores.

| Core                       | Physical lines | Nonblank lines | `unsafe` tokens |
| -------------------------- | -------------: | -------------: | --------------: |
| Original manual ACL        |            427 |            381 |              17 |
| Low-level SDDL             |            438 |            395 |              19 |
| Microsoft `windows` + SDDL |            352 |            317 |              20 |

The typed implementation has 75 fewer lines than original (~18%), but more
unsafe sites. Some reduction comes from implementation choices such as
`IsWellKnownSid`, not the dependency alone. SDDL with `windows-sys` did not
reduce total code or package size at equal opt 3; it replaces manual ACL layout
arithmetic with parser/conversion lifetime handling.

`windows = 0.62.2` supplies typed API signatures and some error plumbing, not a
complete safe ACL abstraction. We still own descriptor allocation lifetimes,
aligned token/SID storage, handle sequencing, and owner/reparse policy. It adds
11 registry packages to this experimental lockfile, not separately shipped DLLs.
A selected implementation would retain only one core.

The published-source dependency investigation found no complete maintained safe
wrapper matching this boundary. `winsafe 0.0.29` lacks the central security-info
and SDDL APIs; `windows-acl` and `windows-permissions` use older `winapi` bindings
and do not cover the whole policy; `qiongli-windows-security` has a specialized
owner-only policy rather than the required existing-handle protected-DACL write.
SID-only helpers and descriptor parsers cannot replace the central operation.
The Microsoft typed binding was therefore implemented and measured rather than
rejected on dependency count alone.

### Runtime linkage

All dynamic cells import `VCRUNTIME140.dll` and UCRT API-set DLLs on both
architectures. Static CRT removes these explicit imports for both interfaces,
with approximately 94 KiB helper / 89 KiB addon universal-package growth versus
low-level opt s. Windows OS DLL dependencies remain.

The typed-binding plus static-CRT combination was not tested. Neither hosted
runner success nor import inspection proves clean-machine portability. Signing,
application control, DLL search/integrity, and addon CRT ownership boundaries
remain deployment review work. No production linkage choice has been made.

The consolidated measurements are in `report.json` of the
`acl-universal-prototypes` artifact from run `34840561914`. The workflow rebuilds
all cells and records source revisions, compiler versions, PE imports, native
bytes, runtime outcomes, and package bytes.

## Reproduce checks

From the repository root:

```sh
cargo build --release --workspace --manifest-path prototypes/windows-acl/Cargo.toml --locked
cargo test --workspace --manifest-path prototypes/windows-acl/Cargo.toml --locked
cargo fmt --all --manifest-path prototypes/windows-acl/Cargo.toml --check
cargo clippy --workspace --all-targets --manifest-path prototypes/windows-acl/Cargo.toml --locked -- -D warnings
cargo check --workspace --tests --target x86_64-pc-windows-msvc --manifest-path prototypes/windows-acl/Cargo.toml --locked
cargo check --workspace --tests --target aarch64-pc-windows-msvc --manifest-path prototypes/windows-acl/Cargo.toml --locked
pnpm exec vitest run --config prototypes/windows-acl/test/vitest.config.mts
node prototypes/windows-acl/transport-probe.cjs
ELECTRON_RUN_AS_NODE=1 pnpm exec electron prototypes/windows-acl/transport-probe.cjs
ELECTRON_RUN_AS_NODE=1 pnpm dlx electron@37.10.3 prototypes/windows-acl/transport-probe.cjs
```

The last three commands are Linux-only transport checks. The two Windows targets
must be installed through rustup for cross-checking. Real Windows binaries need a
Windows SDK/linker toolchain, not merely `rustup target add`.

## Required Windows comparison

Build each architecture using an MSVC-capable environment, then stage:

```sh
cargo build --release --workspace --target x86_64-pc-windows-msvc --manifest-path prototypes/windows-acl/Cargo.toml --locked
node prototypes/windows-acl/stage.cjs --target x86_64-pc-windows-msvc
cargo build --release --workspace --target aarch64-pc-windows-msvc --manifest-path prototypes/windows-acl/Cargo.toml --locked
node prototypes/windows-acl/stage.cjs --target aarch64-pc-windows-msvc
```

Run native core tests on each matching architecture, plus the Vitest suite with
both variants staged. Windows tests require Windows OpenSSH; missing binaries or
OpenSSH fail a Windows run rather than masquerading as a pass. The fixture grants
Everyone write access on a disposable file, proves an SSH Include is rejected,
repairs it through each interface independently, and repeats the check after a
sibling-temp-file replacement. `icacls` is used only to arrange that bad test ACL;
neither implementation invokes it.

With real binaries for both architectures present:

```sh
node prototypes/windows-acl/package-prototype.cjs helper
node prototypes/windows-acl/package-prototype.cjs addon
pnpm exec vitest run --config prototypes/windows-acl/test/vitest.config.mts
```

The experimental extensions have inert activation. Installing them alone does
not exercise ACL behavior; use the bridge/native test harness explicitly.
The archive tests currently use `unzip`; run them on the Linux assembly host.

Before selecting a production implementation, validate clean-machine and
signing/application-control behavior, exercise real editor activation, and
equalize the cores' independent ACL-shape and inheritance assertions.

## Interpretation

Both approaches can preserve a universal VSIX. The helper avoids loading native
code into the extension host and provides a process timeout, at the cost of a
subprocess interface. The addon avoids process launch and successfully loaded
across the tested Electron versions, but loads the native implementation into
the host process. Both passed the same Windows x64/ARM64 tests under Node 22 and Electron
37/42. Neither has been proven operationally superior on end-user machines. The macOS keyring history argues for strict platform gating and
package-level regression tests, not a claim that shipping binaries is risk-free.

## Static CRT follow-up

The user approved accepting a larger package to reduce deployment dependencies.
`projection-s-static` compares typed bindings with the existing dynamic
`projection-s` cell at identical optimization settings. The existing addon
comparison remains intact; the deployment assessment prioritizes the helper.
Static cells fail if the inspected PE import table contains VC/UCRT runtime DLLs.
This checks direct imports, not transitive or dynamically loaded dependencies,
and is not a substitute for running on a clean Windows installation.

Independent typed-core tests check exact file/directory ACEs, real child
inheritance, path rejection, and the owner allow-list. These follow-up changes
require native runner validation; the results above describe the earlier six-cell
experiment, not this seven-cell run.

## Decision gate

For discussion, the typed-binding helper is the strongest measured candidate for
less handwritten Rust and avoiding native code inside the extension host. This
is not a safety proof or an adoption decision. The helper's same-user process
boundary provides memory/crash containment, not a sandbox.

A possible next experiment is typed bindings plus static CRT, with independent
ACL/inheritance tests brought to parity. The user must approve narrowing to that
candidate, further experiments, and any later production integration. Both
interfaces remain experimental; no dependency, profile, or CRT option is selected
for production.

## Prototype limitations

- Existing-path ACL setter only; no secure-at-creation or atomic writer API.
- Final reparse-point rejection and owner validation use the opened handle;
  parent directory chains and hard-link safety are not fully validated.
- Does not integrate generated-file migration or user-config ACL preservation.
- No signing, clean end-user Windows, or enterprise-policy validation yet.
- No production CI/release workflow changes were made.
- Package assembly unit tests use synthetic fixture bytes; those are not Windows
  binaries and are never presented as functional native VSIXs.

## Repository state

Work is on `chore/compare-windows-acl-prototypes`. A delegated agent unexpectedly
committed and pushed the initial test harness as `b698931` despite explicit
instructions not to commit or push. That commit is retained without rewriting or deleting remote history. The user
subsequently authorized a draft PR to execute this comparison on Windows runners.
This branch is experimental and does not publish a production fix.

Generated by Coder Agents.
