# Planning documents

Design proposals for work that has not been done. Nothing here describes the
current state of the repository, and the commands and file paths they mention
are frozen at the moment they were written — several no longer exist.

They live here rather than at the repository root because an untracked file at
the root fails the release script's clean-tree guard, and because a reader
opening the root should find what the package _is_, not what someone once
considered building.

| Document                                         | Proposes                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [NOTE_PROOF.md](NOTE_PROOF.md)                   | A fourth circuit proving knowledge of a note preimage while hiding value and asset         |
| [UNSHIELD_MULTI_PLAN.md](UNSHIELD_MULTI_PLAN.md) | An unshield variant spending two input notes, modelled on `transfer`'s dummy-input pattern |

`test/docs.test.ts` skips this directory: these are proposals, and holding a
proposal to the same accuracy standard as documentation would mean editing it
every time the code moves underneath it.
