#!/usr/bin/env python3
"""Mutation check: break one safety guard at a time and require the tests to notice.

Each mutant removes or weakens exactly one check in the program. For each, the
program is rebuilt and the Rust tests run twice: the property test alone
(tests/invariants.rs, 2,000 random sequences against a reference model) and
the full suite. A mutant is "killed" when at least one test fails. Results go
to eval/mutation.json. The source tree and the built program are restored
afterwards, whatever happens.

    python3 scripts/mutation-check.py
"""
import json
import pathlib
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "programs/holdback/src/instructions"
SO = ROOT / "target/deploy/holdback.so"

# (id, what the mutant breaks, file, original text, mutated text)
MUTANTS = [
    ("M1", "undo allowed after the window ended", "reclaim.rs",
     "require!(\n        now < ctx.accounts.hold.release_at,\n        HoldbackError::WindowOver\n    );",
     "let _ = now;", 2),
    ("M2", "release allowed before the window ends", "release.rs",
     "require!(now >= hold.release_at, HoldbackError::WindowNotOver);",
     "let _ = now;", 1),
    ("M3", "early release by anyone, not only the sender", "release.rs",
     "require_keys_eq!(*caller, hold.sender, HoldbackError::Unauthorized);",
     "let _ = caller;", 1),
    ("M4", "the oracle can shorten a window", "extend_window.rs",
     "require!(\n        new_release_at >= hold.release_at,\n        HoldbackError::WindowCannotShrink\n    );",
     "", 1),
    ("M5", "the oracle can re-lock a window that ended", "extend_window.rs",
     "require!(now < hold.release_at, HoldbackError::WindowOver);",
     "", 1),
    ("M6", "the oracle can lower the tier", "extend_window.rs",
     "require!(tier >= hold.tier, HoldbackError::TierCannotDrop);",
     "", 1),
    ("M7", "the relayer can undo any hold, not only deposit-box holds", "reclaim.rs",
     "|| (hold.origin == origin::DEPOSIT_BOX && *authority == config.relayer)",
     "|| *authority == config.relayer", 1),
    ("M8", "a refund can go to any token account of the mint", "reclaim.rs",
     "token::authority = hold.sender,",
     "", 1),
    ("M9", "deposit-box withdrawals can go to anyone", "deposit_box.rs",
     "token::authority = deposit_box.owner,",
     "", 1),
    ("M10", "the relayer can open holds shorter than the default window", "deposit_box.rs",
     "config.default_window_secs.max(config.min_window_secs),",
     "config.min_window_secs,", 1),
    ("M11", "a pending hold can be closed", "close_hold.rs",
     "constraint = hold.status != status::PENDING @ HoldbackError::HoldStillPending,",
     "", 1),
    ("M12", "an assessment signed by anyone is accepted", "attested.rs",
     "require_keys_eq!(signed.signer, *oracle, HoldbackError::WrongAttester);",
     "", 1),
]


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)


def tests_fail(*args):
    out = run(["cargo", "test", "-p", "holdback", *args])
    return out.returncode != 0


def main():
    backup_so = SO.with_suffix(".so.mutation-backup")
    shutil.copy2(SO, backup_so)
    results = []
    try:
        for mid, what, file, original, mutated, count in MUTANTS:
            path = SRC / file
            source = path.read_text()
            if source.count(original) < 1:
                sys.exit(f"{mid}: guard text not found in {file}")
            path.write_text(source.replace(original, mutated, count))
            try:
                started = time.time()
                build = run(["anchor", "build", "--ignore-keys"])
                if build.returncode != 0:
                    results.append(dict(id=mid, breaks=what, file=file, status="did not compile"))
                    print(f"{mid}: did not compile")
                    continue
                by_property = tests_fail("--test", "invariants")
                by_suite = by_property or tests_fail()
                results.append(dict(
                    id=mid, breaks=what, file=file,
                    killed=by_suite, killed_by_property_test=by_property,
                    seconds=round(time.time() - started),
                ))
                print(f"{mid}: {'killed' if by_suite else 'SURVIVED'}"
                      f"{' (property test)' if by_property else ''}  {what}")
            finally:
                path.write_text(source)
    finally:
        run(["anchor", "build", "--ignore-keys"])
        shutil.copy2(backup_so, SO)
        backup_so.unlink()

    killed = sum(1 for r in results if r.get("killed"))
    by_property = sum(1 for r in results if r.get("killed_by_property_test"))
    report = dict(
        mutants=len(results), killed=killed, killed_by_property_test=by_property,
        property_test_cases_per_mutant=2000, results=results,
    )
    (ROOT / "eval/mutation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"\n{killed} of {len(results)} mutants killed; {by_property} by the property test alone")


if __name__ == "__main__":
    main()
