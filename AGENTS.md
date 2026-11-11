# Repository workflow

Use `main` as the delivery branch. The owner's preferred workflow is to make
changes, run the relevant checks, commit, and push directly to `origin/main`.
Do not create feature branches, pull requests, or merge commits unless the owner
explicitly requests them for that task. Completing a change includes pushing it;
do not stop at a local commit or ask for routine confirmation to push.

Before editing, fetch `origin` and work from the latest `origin/main`. If the
environment starts on a temporary branch, switch to `main` while preserving any
existing work. Synchronize with fast-forward pulls; if concurrent commits arrive
after local work starts, rebase the local commits onto `origin/main`, resolve
conflicts, rerun affected checks, and push normally. Never force-push `main` or
discard unrelated work.

Run checks appropriate to the change before pushing and report any failures.
Keep the existing CI checks enabled for direct pushes.

Here, delivery to `main` means publishing source changes. It does not itself
install software on a TV or publish a tagged release. Follow an explicitly
requested deployment or release procedure when those actions are part of the task.
