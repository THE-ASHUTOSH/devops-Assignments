# Git / GitHub

Did this in a throwaway repo so the history stays clean, full transcript at the bottom.

## Task 1 - `git commit -m` vs `git commit -a -m`

`git commit -m "msg"` commits **only what is staged**. `git commit -a -m "msg"` stages every
**tracked** file that was modified or deleted first, then commits. The `-a` does not touch
untracked files.

So:

| | staged changes | modified tracked file | brand new untracked file |
|---|---|---|---|
| `git commit -m` | committed | ignored | ignored |
| `git commit -a -m` | committed | committed | still ignored |

The transcript shows all three cases. I modified `notes.txt` (tracked) and created `extra.txt`
(untracked), then:

- `git commit -m 'try without staging'` refused and printed
  `no changes added to commit (use "git add" and/or "git commit -a")`.
- `git commit -a -m 'update notes with -a'` committed the notes.txt change without any `git add`.
- `git status --short` afterwards still showed `?? extra.txt`, and `git ls-files` still listed only
  notes.txt, so `-a` genuinely skipped it. Needed an explicit `git add extra.txt`.

The `??` vs ` M` in `git status --short` is the whole thing - `-a` handles the second column, it
does nothing about `??`.

Handy to know: `-a` also picks up **deletions** of tracked files, which is the part people forget.
And it's the reason `git commit -am` is fine for quick edits but risky when you only meant to
commit part of your working tree.

## Task 2 - cherry-pick

Setup: main got 4 commits, then a `feature-work` branch got 3 more. I wanted only the middle
feature commit in main.

```bash
git log --oneline                                    # look at history
git log --oneline --grep='hotfix I actually want'    # find the one commit
git checkout main
git cherry-pick 35bc799
```

Before the pick, main had 5 commits and `cat hotfix.txt` failed with "No such file or directory".
After the pick:

```
9a71e20 feature: the hotfix I actually want in main
5635b38 main: add line B
...
$ cat hotfix.txt
IMPORTANT HOTFIX
```

So the change landed, and the graph shows the two branches diverging with the same change sitting
on both sides:

```
* c07ac51 (feature-work) feature: third change
* 35bc799 feature: the hotfix I actually want in main
* dc64fc4 feature: first change
| * 9a71e20 (HEAD -> main) feature: the hotfix I actually want in main
|/
* 5635b38 main: add line B
```

Two hashes for the same change - 35bc799 on the branch, 9a71e20 on main. Cherry-pick replays the
diff as a **new commit**, it does not move the original. That's why `git log main..feature-work`
still lists all three feature commits, which looked wrong to me at first. The command that
actually understands it is `git cherry`:

```
$ git cherry -v main feature-work
+ dc64fc4 feature: first change
- 35bc799 feature: the hotfix I actually want in main
+ c07ac5194 feature: third change
```

`-` means "already in main as an equivalent patch", `+` means "not there yet". Same answer from
`git log --cherry-pick --right-only main...feature-work`, which lists only the two commits that
are genuinely missing.

Worth remembering: cherry-pick keeps the original author and message but gets a new committer and
new hash, `-x` appends a "(cherry picked from commit ...)" line to the message, and conflicts are
resolved then continued with `git cherry-pick --continue` (or `--abort` to back out).

## Full transcript

```console
==================== TASK 1: git commit -m vs git commit -a -m ====================

$ git add notes.txt

$ git commit -m 'add notes file'
[main (root-commit) 9b84340] add notes file
 1 file changed, 1 insertion(+)
 create mode 100644 notes.txt

--- now change a TRACKED file and create an UNTRACKED file ---

$ echo 'notes v2' > notes.txt

$ echo 'brand new' > extra.txt

$ git status --short
 M notes.txt
?? extra.txt

--- attempt 1: plain 'git commit -m' with nothing staged ---

$ git commit -m 'try without staging'
On branch main
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   notes.txt

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	extra.txt

no changes added to commit (use "git add" and/or "git commit -a")

--- attempt 2: 'git commit -a -m' (stages tracked modifications for you) ---

$ git commit -a -m 'update notes with -a'
[main 376d99a] update notes with -a
 1 file changed, 1 insertion(+), 1 deletion(-)

$ git status --short
?? extra.txt

$ git show --stat --oneline HEAD
376d99a update notes with -a
 notes.txt | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

--- proof: -a did NOT pick up the untracked file ---

$ git ls-files
notes.txt

$ git status --short
?? extra.txt

$ git add extra.txt && git commit -m 'add extra.txt, needed explicit git add'
[main 9b08f82] add extra.txt, needed explicit git add
 1 file changed, 1 insertion(+)
 create mode 100644 extra.txt

$ git log --oneline
9b08f82 add extra.txt, needed explicit git add
376d99a update notes with -a
9b84340 add notes file

==================== TASK 2: cherry-pick ====================
--- build up main to 4 commits total ---

$ echo 'line A' >> app.txt && git add app.txt && git commit -m 'main: start app.txt'
[main 44c16d6] main: start app.txt
 1 file changed, 1 insertion(+)
 create mode 100644 app.txt

$ echo 'line B' >> app.txt && git commit -a -m 'main: add line B'
[main 5635b38] main: add line B
 1 file changed, 1 insertion(+)

$ git log --oneline
5635b38 main: add line B
44c16d6 main: start app.txt
9b08f82 add extra.txt, needed explicit git add
376d99a update notes with -a
9b84340 add notes file

$ git log --graph --oneline --decorate --all
* 5635b38 (HEAD -> main) main: add line B
* 44c16d6 main: start app.txt
* 9b08f82 add extra.txt, needed explicit git add
* 376d99a update notes with -a
* 9b84340 add notes file

--- new branch with 3 commits ---

$ git checkout -b feature-work
Switched to a new branch 'feature-work'

$ echo 'feature one' > f1.txt && git add f1.txt && git commit -m 'feature: first change'
[feature-work dc64fc4] feature: first change
 1 file changed, 1 insertion(+)
 create mode 100644 f1.txt

$ echo 'IMPORTANT HOTFIX' > hotfix.txt && git add hotfix.txt && git commit -m 'feature: the hotfix I actually want in main'
[feature-work 35bc799] feature: the hotfix I actually want in main
 1 file changed, 1 insertion(+)
 create mode 100644 hotfix.txt

$ echo 'feature three' > f3.txt && git add f3.txt && git commit -m 'feature: third change'
[feature-work c07ac51] feature: third change
 1 file changed, 1 insertion(+)
 create mode 100644 f3.txt

$ git log --oneline
c07ac51 feature: third change
35bc799 feature: the hotfix I actually want in main
dc64fc4 feature: first change
5635b38 main: add line B
44c16d6 main: start app.txt
9b08f82 add extra.txt, needed explicit git add
376d99a update notes with -a
9b84340 add notes file

--- find the specific commit to pick ---

$ git log --oneline --grep='hotfix I actually want'
35bc799 feature: the hotfix I actually want in main

commit to cherry-pick: 35bc799eff8e98e189c8379668caadcfc49becb2

$ git show --stat --oneline 35bc799eff8e98e189c8379668caadcfc49becb2
35bc799 feature: the hotfix I actually want in main
 hotfix.txt | 1 +
 1 file changed, 1 insertion(+)

--- back to main, which does NOT have the hotfix ---

$ git checkout main
Switched to branch 'main'

$ git log --oneline
5635b38 main: add line B
44c16d6 main: start app.txt
9b08f82 add extra.txt, needed explicit git add
376d99a update notes with -a
9b84340 add notes file

$ ls
app.txt
extra.txt
notes.txt

$ cat hotfix.txt
cat: hotfix.txt: No such file or directory

--- cherry-pick just that one commit ---

$ git cherry-pick 35bc799eff8e98e189c8379668caadcfc49becb2
[main 9a71e20] feature: the hotfix I actually want in main
 Date: Thu Sep 3 22:49:34 2026 +0530
 1 file changed, 1 insertion(+)
 create mode 100644 hotfix.txt

==================== VERIFY ====================

$ git log --oneline
9a71e20 feature: the hotfix I actually want in main
5635b38 main: add line B
44c16d6 main: start app.txt
9b08f82 add extra.txt, needed explicit git add
376d99a update notes with -a
9b84340 add notes file

$ ls
app.txt
extra.txt
hotfix.txt
notes.txt

$ cat hotfix.txt
IMPORTANT HOTFIX

$ git log --graph --oneline --decorate --all
* c07ac51 (feature-work) feature: third change
* 35bc799 feature: the hotfix I actually want in main
* dc64fc4 feature: first change
| * 9a71e20 (HEAD -> main) feature: the hotfix I actually want in main
|/  
* 5635b38 main: add line B
* 44c16d6 main: start app.txt
* 9b08f82 add extra.txt, needed explicit git add
* 376d99a update notes with -a
* 9b84340 add notes file

$ git show --stat --oneline HEAD
9a71e20 feature: the hotfix I actually want in main
 hotfix.txt | 1 +
 1 file changed, 1 insertion(+)

--- the other two feature commits are still NOT in main ---

$ git log --oneline main..feature-work
c07ac51 feature: third change
35bc799 feature: the hotfix I actually want in main
dc64fc4 feature: first change

$ git branch -v
  feature-work c07ac51 feature: third change
* main         9a71e20 feature: the hotfix I actually want in main

$ git cherry -v main feature-work
+ dc64fc4f6f09c7b1a4986133570f2c294770b4af feature: first change
- 35bc799eff8e98e189c8379668caadcfc49becb2 feature: the hotfix I actually want in main
+ c07ac5194a82d2ed04f57b631179ccfa2d286583 feature: third change

$ git show HEAD --format="%H %an <%ae>" --no-patch
9a71e2090af5f7f27a3a2c7e2a57c29784528d4b THE-ASHUTOSH <ashubham1906@gmail.com>

$ git log --oneline --cherry-pick --right-only main...feature-work
c07ac51 feature: third change
dc64fc4 feature: first change
```
