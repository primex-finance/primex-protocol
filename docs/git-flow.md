## Git flow
This section describes the rules for using git on this project.

### Branches
All new features must be reviewed and merged into the correct branch using a pull request.
- **master** - master branch, tested and ready version of the application for production use;
- **develop** - the most up-to-date and unstable branch in which development is underway;

#### Branch rules for developers
All development is done in the **develop** branch. In order to add new functionality or any edits
you need to create a new branch from this branch according to the following rules:

**{type}/{task-number}-{title}**

- **{type}** - a type that defines the main goal of this branch; [FEAT, DOCS, FIX, REFACTOR, STYLE, TEST, REVERT, BUILD]
- **{task-number}** - number of the issue to which this branch belongs; [PRIM-XX]
- **{title}** - one, two words describing the content of this branch; [some-description]

#### Rules for writing comments to a commit
Commit comments are written according to the rule:
**{type}({task-number}):{message}**

- **{type}** - a type that defines the main goal of this branch; [feat, docs, fix, refactor, style, test, revert, build]
- **{task-number}** - number of the issue to which this branch belongs; [PRIM-XX]
- **{message}** - commit message; [Edit useTest hook return logic]

To check writing a commit on a project, use [commitlint](https://github.com/conventional-changelog/commitlint)

#### Pull request rules
Pull request name are written according to the rule:
**{task-number}:{message}**

- **{task-number}** - number of the issue to which this branch belongs; [PRIM-XX]
- **{message}** - commit message; [Edit useTest hook return logic]

**Note**
- Changing parent branch in Pull request via **rebase**
- Merge in parent branch via using **squash merge**
- Branch after merging should be **deleted**