const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');
const simpleGit = require('simple-git');

/**
 * VersionControlModule - Git integration for version control
 * Provides comprehensive Git operations and workflow management
 */
class VersionControlModule extends EventEmitter {
    constructor() {
        super();
        this.git = null;
        this.currentRepo = null;
        this.currentBranch = 'main';
        this.remotes = new Map();
        this.stashList = [];
        this.gitFlow = {
            enabled: false,
            branches: {
                master: 'main',
                develop: 'develop',
                feature: 'feature/',
                release: 'release/',
                hotfix: 'hotfix/'
            }
        };
        this.hooks = new Map();
        this.autoCommitEnabled = false;
        this.autoCommitInterval = null;
    }

    /**
     * Initialize version control module
     */
    async initialize(repoPath) {
        try {
            this.currentRepo = repoPath;
            this.git = simpleGit(repoPath);
            
            // Check if Git is installed
            const isGitInstalled = await this.checkGitInstallation();
            if (!isGitInstalled) {
                throw new Error('Git is not installed on this system');
            }

            // Check if current directory is a Git repository
            const isRepo = await this.isRepository();
            if (!isRepo) {
                // Initialize new repository
                await this.initRepository();
            }

            // Get current branch
            const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
            this.currentBranch = branch.trim();

            // Load remotes
            await this.loadRemotes();

            // Setup hooks
            await this.setupHooks();

            console.log(`Version control initialized for: ${repoPath}`);
            this.emit('initialized', { path: repoPath, branch: this.currentBranch });

            return { success: true, branch: this.currentBranch };
        } catch (error) {
            console.error('Failed to initialize version control:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if Git is installed
     */
    async checkGitInstallation() {
        return new Promise((resolve) => {
            exec('git --version', (error) => {
                resolve(!error);
            });
        });
    }

    /**
     * Check if current directory is a Git repository
     */
    async isRepository() {
        try {
            await this.git.status();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Initialize a new Git repository
     */
    async initRepository(options = {}) {
        try {
            await this.git.init();
            
            // Set default branch name
            const defaultBranch = options.defaultBranch || 'main';
            await this.git.branch(['-M', defaultBranch]);
            
            // Create initial commit if requested
            if (options.initialCommit !== false) {
                await this.createGitignore();
                await this.git.add('.gitignore');
                await this.git.commit('Initial commit');
            }

            this.currentBranch = defaultBranch;
            this.emit('repository-initialized');

            return { success: true, branch: defaultBranch };
        } catch (error) {
            console.error('Failed to initialize repository:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Clone a remote repository
     */
    async cloneRepository(remoteUrl, localPath, options = {}) {
        try {
            const cloneOptions = [];
            
            if (options.branch) {
                cloneOptions.push('--branch', options.branch);
            }
            
            if (options.depth) {
                cloneOptions.push('--depth', options.depth);
            }
            
            if (options.recursive) {
                cloneOptions.push('--recursive');
            }

            await simpleGit().clone(remoteUrl, localPath, cloneOptions);
            
            // Initialize the module with the cloned repository
            await this.initialize(localPath);
            
            this.emit('repository-cloned', { remote: remoteUrl, local: localPath });
            
            return { success: true, path: localPath };
        } catch (error) {
            console.error('Failed to clone repository:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get repository status
     */
    async getStatus() {
        try {
            const status = await this.git.status();
            
            return {
                success: true,
                branch: status.current,
                ahead: status.ahead,
                behind: status.behind,
                staged: status.staged,
                modified: status.modified,
                deleted: status.deleted,
                untracked: status.not_added,
                conflicted: status.conflicted,
                isClean: status.isClean()
            };
        } catch (error) {
            console.error('Failed to get status:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stage files for commit
     */
    async stageFiles(files) {
        try {
            if (Array.isArray(files)) {
                await this.git.add(files);
            } else if (files === '*' || files === '.') {
                await this.git.add('.');
            } else {
                await this.git.add(files);
            }
            
            this.emit('files-staged', files);
            
            return { success: true, staged: files };
        } catch (error) {
            console.error('Failed to stage files:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Unstage files
     */
    async unstageFiles(files) {
        try {
            if (Array.isArray(files)) {
                await this.git.reset(['HEAD', ...files]);
            } else {
                await this.git.reset(['HEAD', files]);
            }
            
            this.emit('files-unstaged', files);
            
            return { success: true, unstaged: files };
        } catch (error) {
            console.error('Failed to unstage files:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Commit changes
     */
    async commit(message, options = {}) {
        try {
            // Run pre-commit hook
            if (this.hooks.has('pre-commit')) {
                const hookResult = await this.runHook('pre-commit');
                if (!hookResult.success) {
                    throw new Error('Pre-commit hook failed');
                }
            }

            const commitOptions = [];
            
            if (options.amend) {
                commitOptions.push('--amend');
            }
            
            if (options.noVerify) {
                commitOptions.push('--no-verify');
            }
            
            if (options.signoff) {
                commitOptions.push('--signoff');
            }

            const result = await this.git.commit(message, null, commitOptions);
            
            // Run post-commit hook
            if (this.hooks.has('post-commit')) {
                await this.runHook('post-commit');
            }
            
            this.emit('commit-created', { 
                hash: result.commit, 
                message,
                branch: result.branch 
            });
            
            return { 
                success: true, 
                commit: result.commit,
                branch: result.branch,
                summary: result.summary
            };
        } catch (error) {
            console.error('Failed to commit:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Push changes to remote
     */
    async push(remote = 'origin', branch = null, options = {}) {
        try {
            const pushOptions = [];
            
            if (options.force) {
                pushOptions.push('--force');
            }
            
            if (options.setUpstream) {
                pushOptions.push('--set-upstream');
            }
            
            if (options.tags) {
                pushOptions.push('--tags');
            }

            const targetBranch = branch || this.currentBranch;
            await this.git.push(remote, targetBranch, pushOptions);
            
            this.emit('pushed', { remote, branch: targetBranch });
            
            return { success: true, remote, branch: targetBranch };
        } catch (error) {
            console.error('Failed to push:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Pull changes from remote
     */
    async pull(remote = 'origin', branch = null, options = {}) {
        try {
            const pullOptions = [];
            
            if (options.rebase) {
                pullOptions.push('--rebase');
            }
            
            if (options.noCommit) {
                pullOptions.push('--no-commit');
            }

            const targetBranch = branch || this.currentBranch;
            const result = await this.git.pull(remote, targetBranch, pullOptions);
            
            this.emit('pulled', { 
                remote, 
                branch: targetBranch,
                summary: result.summary
            });
            
            return { 
                success: true, 
                remote, 
                branch: targetBranch,
                files: result.files,
                insertions: result.insertions,
                deletions: result.deletions
            };
        } catch (error) {
            console.error('Failed to pull:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Fetch changes from remote
     */
    async fetch(remote = 'origin', options = {}) {
        try {
            const fetchOptions = [];
            
            if (options.all) {
                fetchOptions.push('--all');
            }
            
            if (options.prune) {
                fetchOptions.push('--prune');
            }
            
            if (options.tags) {
                fetchOptions.push('--tags');
            }

            await this.git.fetch(remote, fetchOptions);
            
            this.emit('fetched', { remote });
            
            return { success: true, remote };
        } catch (error) {
            console.error('Failed to fetch:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Create a new branch
     */
    async createBranch(branchName, options = {}) {
        try {
            // Check if branch already exists
            const branches = await this.git.branchLocal();
            if (branches.all.includes(branchName)) {
                throw new Error(`Branch '${branchName}' already exists`);
            }

            await this.git.checkoutLocalBranch(branchName);
            
            if (options.push) {
                await this.push('origin', branchName, { setUpstream: true });
            }
            
            this.currentBranch = branchName;
            this.emit('branch-created', { branch: branchName });
            
            return { success: true, branch: branchName };
        } catch (error) {
            console.error('Failed to create branch:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Switch to a different branch
     */
    async switchBranch(branchName, options = {}) {
        try {
            if (options.create) {
                await this.git.checkoutLocalBranch(branchName);
            } else {
                await this.git.checkout(branchName);
            }
            
            this.currentBranch = branchName;
            this.emit('branch-switched', { branch: branchName });
            
            return { success: true, branch: branchName };
        } catch (error) {
            console.error('Failed to switch branch:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a branch
     */
    async deleteBranch(branchName, options = {}) {
        try {
            const deleteOptions = options.force ? ['-D'] : ['-d'];
            
            await this.git.deleteLocalBranch(branchName, options.force);
            
            if (options.remote) {
                await this.git.push('origin', `:${branchName}`);
            }
            
            this.emit('branch-deleted', { branch: branchName });
            
            return { success: true, branch: branchName };
        } catch (error) {
            console.error('Failed to delete branch:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Merge branches
     */
    async merge(branchName, options = {}) {
        try {
            const mergeOptions = [];
            
            if (options.noFf) {
                mergeOptions.push('--no-ff');
            }
            
            if (options.squash) {
                mergeOptions.push('--squash');
            }
            
            if (options.strategy) {
                mergeOptions.push('--strategy', options.strategy);
            }

            const result = await this.git.merge([branchName, ...mergeOptions]);
            
            this.emit('merged', { 
                from: branchName, 
                to: this.currentBranch,
                result 
            });
            
            return { 
                success: true, 
                from: branchName,
                to: this.currentBranch,
                result
            };
        } catch (error) {
            console.error('Failed to merge:', error);
            
            // Check for merge conflicts
            const status = await this.git.status();
            if (status.conflicted.length > 0) {
                return { 
                    success: false, 
                    error: 'Merge conflicts detected',
                    conflicts: status.conflicted
                };
            }
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Rebase branches
     */
    async rebase(branchName, options = {}) {
        try {
            const rebaseOptions = [];
            
            if (options.interactive) {
                rebaseOptions.push('-i');
            }
            
            if (options.onto) {
                rebaseOptions.push('--onto', options.onto);
            }

            await this.git.rebase([branchName, ...rebaseOptions]);
            
            this.emit('rebased', { onto: branchName });
            
            return { success: true, onto: branchName };
        } catch (error) {
            console.error('Failed to rebase:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Create a tag
     */
    async createTag(tagName, message = null, options = {}) {
        try {
            const tagOptions = [];
            
            if (message) {
                tagOptions.push('-a', tagName, '-m', message);
            } else {
                tagOptions.push(tagName);
            }
            
            if (options.force) {
                tagOptions.push('-f');
            }

            await this.git.addTag(tagOptions);
            
            if (options.push) {
                await this.git.pushTags('origin');
            }
            
            this.emit('tag-created', { tag: tagName });
            
            return { success: true, tag: tagName };
        } catch (error) {
            console.error('Failed to create tag:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get commit history
     */
    async getHistory(options = {}) {
        try {
            const logOptions = {
                maxCount: options.limit || 50,
                '--oneline': options.oneline || false
            };
            
            if (options.since) {
                logOptions['--since'] = options.since;
            }
            
            if (options.until) {
                logOptions['--until'] = options.until;
            }
            
            if (options.author) {
                logOptions['--author'] = options.author;
            }

            const log = await this.git.log(logOptions);
            
            return {
                success: true,
                commits: log.all,
                latest: log.latest,
                total: log.total
            };
        } catch (error) {
            console.error('Failed to get history:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Show diff of changes
     */
    async getDiff(options = {}) {
        try {
            const diffOptions = [];
            
            if (options.staged) {
                diffOptions.push('--cached');
            }
            
            if (options.nameOnly) {
                diffOptions.push('--name-only');
            }
            
            if (options.commit) {
                diffOptions.push(options.commit);
            }

            const diff = await this.git.diff(diffOptions);
            
            return {
                success: true,
                diff,
                files: this.parseDiff(diff)
            };
        } catch (error) {
            console.error('Failed to get diff:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stash changes
     */
    async stash(message = null, options = {}) {
        try {
            const stashOptions = [];
            
            if (message) {
                stashOptions.push('save', message);
            }
            
            if (options.includeUntracked) {
                stashOptions.push('--include-untracked');
            }
            
            if (options.keepIndex) {
                stashOptions.push('--keep-index');
            }

            await this.git.stash(stashOptions);
            
            // Update stash list
            await this.updateStashList();
            
            this.emit('stashed', { message });
            
            return { success: true, message };
        } catch (error) {
            console.error('Failed to stash:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Apply stashed changes
     */
    async stashApply(stashRef = 'stash@{0}', options = {}) {
        try {
            const applyOptions = ['apply', stashRef];
            
            if (options.index) {
                applyOptions.push('--index');
            }

            await this.git.stash(applyOptions);
            
            this.emit('stash-applied', { stash: stashRef });
            
            return { success: true, stash: stashRef };
        } catch (error) {
            console.error('Failed to apply stash:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Pop stashed changes
     */
    async stashPop(stashRef = 'stash@{0}') {
        try {
            await this.git.stash(['pop', stashRef]);
            
            // Update stash list
            await this.updateStashList();
            
            this.emit('stash-popped', { stash: stashRef });
            
            return { success: true, stash: stashRef };
        } catch (error) {
            console.error('Failed to pop stash:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update stash list
     */
    async updateStashList() {
        try {
            const stashList = await this.git.stashList();
            this.stashList = stashList.all;
            return { success: true, stashes: this.stashList };
        } catch (error) {
            console.error('Failed to update stash list:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cherry-pick commits
     */
    async cherryPick(commits, options = {}) {
        try {
            const cherryPickOptions = [];
            
            if (options.noCommit) {
                cherryPickOptions.push('-n');
            }
            
            if (options.edit) {
                cherryPickOptions.push('-e');
            }

            const commitList = Array.isArray(commits) ? commits : [commits];
            
            for (const commit of commitList) {
                await this.git.raw(['cherry-pick', commit, ...cherryPickOptions]);
            }
            
            this.emit('cherry-picked', { commits: commitList });
            
            return { success: true, commits: commitList };
        } catch (error) {
            console.error('Failed to cherry-pick:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Revert commits
     */
    async revert(commits, options = {}) {
        try {
            const revertOptions = [];
            
            if (options.noCommit) {
                revertOptions.push('-n');
            }
            
            if (options.noEdit) {
                revertOptions.push('--no-edit');
            }

            const commitList = Array.isArray(commits) ? commits : [commits];
            
            for (const commit of commitList) {
                await this.git.revert(commit, revertOptions);
            }
            
            this.emit('reverted', { commits: commitList });
            
            return { success: true, commits: commitList };
        } catch (error) {
            console.error('Failed to revert:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Reset to a specific commit
     */
    async reset(target = 'HEAD', options = {}) {
        try {
            const resetOptions = [];
            
            if (options.hard) {
                resetOptions.push('--hard');
            } else if (options.soft) {
                resetOptions.push('--soft');
            } else {
                resetOptions.push('--mixed');
            }
            
            resetOptions.push(target);

            await this.git.reset(resetOptions);
            
            this.emit('reset', { target, mode: resetOptions[0] });
            
            return { success: true, target, mode: resetOptions[0] };
        } catch (error) {
            console.error('Failed to reset:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Clean untracked files
     */
    async clean(options = {}) {
        try {
            const cleanOptions = ['-f'];
            
            if (options.directories) {
                cleanOptions.push('-d');
            }
            
            if (options.force) {
                cleanOptions.push('-f');
            }
            
            if (options.dryRun) {
                cleanOptions.push('-n');
            }

            await this.git.clean(cleanOptions);
            
            this.emit('cleaned');
            
            return { success: true };
        } catch (error) {
            console.error('Failed to clean:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Add remote repository
     */
    async addRemote(name, url) {
        try {
            await this.git.addRemote(name, url);
            await this.loadRemotes();
            
            this.emit('remote-added', { name, url });
            
            return { success: true, name, url };
        } catch (error) {
            console.error('Failed to add remote:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove remote repository
     */
    async removeRemote(name) {
        try {
            await this.git.removeRemote(name);
            await this.loadRemotes();
            
            this.emit('remote-removed', { name });
            
            return { success: true, name };
        } catch (error) {
            console.error('Failed to remove remote:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Load remote repositories
     */
    async loadRemotes() {
        try {
            const remotes = await this.git.getRemotes(true);
            
            this.remotes.clear();
            remotes.forEach(remote => {
                this.remotes.set(remote.name, {
                    fetch: remote.refs.fetch,
                    push: remote.refs.push
                });
            });
            
            return { success: true, remotes: Array.from(this.remotes.entries()) };
        } catch (error) {
            console.error('Failed to load remotes:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup Git Flow
     */
    async setupGitFlow(config = {}) {
        try {
            this.gitFlow = {
                enabled: true,
                branches: {
                    master: config.master || 'main',
                    develop: config.develop || 'develop',
                    feature: config.feature || 'feature/',
                    release: config.release || 'release/',
                    hotfix: config.hotfix || 'hotfix/'
                }
            };

            // Create develop branch if it doesn't exist
            const branches = await this.git.branchLocal();
            if (!branches.all.includes(this.gitFlow.branches.develop)) {
                await this.createBranch(this.gitFlow.branches.develop);
            }

            this.emit('gitflow-initialized', this.gitFlow);
            
            return { success: true, config: this.gitFlow };
        } catch (error) {
            console.error('Failed to setup Git Flow:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Start a Git Flow feature
     */
    async startFeature(featureName) {
        try {
            if (!this.gitFlow.enabled) {
                throw new Error('Git Flow is not enabled');
            }

            const branchName = `${this.gitFlow.branches.feature}${featureName}`;
            
            // Switch to develop branch
            await this.switchBranch(this.gitFlow.branches.develop);
            
            // Create feature branch
            await this.createBranch(branchName);
            
            this.emit('feature-started', { feature: featureName, branch: branchName });
            
            return { success: true, branch: branchName };
        } catch (error) {
            console.error('Failed to start feature:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Finish a Git Flow feature
     */
    async finishFeature(featureName, options = {}) {
        try {
            if (!this.gitFlow.enabled) {
                throw new Error('Git Flow is not enabled');
            }

            const branchName = `${this.gitFlow.branches.feature}${featureName}`;
            
            // Switch to develop branch
            await this.switchBranch(this.gitFlow.branches.develop);
            
            // Merge feature branch
            await this.merge(branchName, { noFf: !options.ff });
            
            // Delete feature branch
            if (!options.keepBranch) {
                await this.deleteBranch(branchName);
            }
            
            this.emit('feature-finished', { feature: featureName });
            
            return { success: true, feature: featureName };
        } catch (error) {
            console.error('Failed to finish feature:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Create .gitignore file
     */
    async createGitignore(template = 'node') {
        try {
            const templates = {
                node: `
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment files
.env
.env.local
.env.*.local

# Build output
dist/
build/
out/

# IDE files
.vscode/
.idea/
*.sublime-*

# OS files
.DS_Store
Thumbs.db

# Logs
logs/
*.log

# Testing
coverage/
.nyc_output/

# Temporary files
tmp/
temp/
`,
                python: `
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
env/
venv/
.venv
pip-log.txt
pip-delete-this-directory.txt

# Distribution
dist/
build/
*.egg-info/

# IDE
.idea/
.vscode/
*.swp
*.swo

# Testing
.pytest_cache/
.coverage
htmlcov/

# Environment
.env
`,
                general: `
# OS files
.DS_Store
Thumbs.db
desktop.ini

# Editor files
*.swp
*.swo
*~
.idea/
.vscode/

# Temporary files
tmp/
temp/
*.tmp
*.bak

# Logs
*.log
logs/
`
            };

            const content = templates[template] || templates.general;
            const gitignorePath = path.join(this.currentRepo, '.gitignore');
            
            await fs.writeFile(gitignorePath, content.trim(), 'utf8');
            
            this.emit('gitignore-created');
            
            return { success: true, path: gitignorePath };
        } catch (error) {
            console.error('Failed to create .gitignore:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup Git hooks
     */
    async setupHooks() {
        try {
            const hooksPath = path.join(this.currentRepo, '.git', 'hooks');
            
            // Define default hooks
            const defaultHooks = {
                'pre-commit': `#!/bin/sh
# Pre-commit hook
# Run tests before committing
npm test
`,
                'commit-msg': `#!/bin/sh
# Commit message validation
# Check commit message format
commit_regex='^(feat|fix|docs|style|refactor|test|chore)(\(.+\))?: .+$'
commit_msg=$(cat $1)
if ! echo "$commit_msg" | grep -qE "$commit_regex"; then
    echo "Invalid commit message format!"
    echo "Format: type(scope): message"
    echo "Example: feat(auth): add login functionality"
    exit 1
fi
`,
                'pre-push': `#!/bin/sh
# Pre-push hook
# Run tests before pushing
npm test
`
            };

            for (const [hookName, hookContent] of Object.entries(defaultHooks)) {
                const hookPath = path.join(hooksPath, hookName);
                await fs.writeFile(hookPath, hookContent, { mode: 0o755 });
                this.hooks.set(hookName, hookPath);
            }
            
            return { success: true, hooks: Array.from(this.hooks.keys()) };
        } catch (error) {
            console.error('Failed to setup hooks:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Run a Git hook
     */
    async runHook(hookName) {
        return new Promise((resolve) => {
            const hookPath = this.hooks.get(hookName);
            if (!hookPath) {
                resolve({ success: true });
                return;
            }

            exec(hookPath, { cwd: this.currentRepo }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Hook ${hookName} failed:`, stderr);
                    resolve({ success: false, error: stderr });
                } else {
                    resolve({ success: true, output: stdout });
                }
            });
        });
    }

    /**
     * Enable auto-commit
     */
    enableAutoCommit(interval = 300000, message = 'Auto-commit') {
        this.autoCommitEnabled = true;
        
        this.autoCommitInterval = setInterval(async () => {
            const status = await this.getStatus();
            
            if (!status.isClean) {
                await this.stageFiles('.');
                await this.commit(`${message}: ${new Date().toISOString()}`);
                console.log('Auto-commit executed');
            }
        }, interval);
        
        this.emit('auto-commit-enabled', { interval });
    }

    /**
     * Disable auto-commit
     */
    disableAutoCommit() {
        this.autoCommitEnabled = false;
        
        if (this.autoCommitInterval) {
            clearInterval(this.autoCommitInterval);
            this.autoCommitInterval = null;
        }
        
        this.emit('auto-commit-disabled');
    }

    /**
     * Parse diff output
     */
    parseDiff(diff) {
        const files = [];
        const lines = diff.split('\n');
        let currentFile = null;
        
        lines.forEach(line => {
            if (line.startsWith('diff --git')) {
                const match = line.match(/b\/(.+)$/);
                if (match) {
                    currentFile = {
                        path: match[1],
                        additions: 0,
                        deletions: 0,
                        changes: []
                    };
                    files.push(currentFile);
                }
            } else if (currentFile) {
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    currentFile.additions++;
                    currentFile.changes.push({ type: 'add', content: line.slice(1) });
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    currentFile.deletions++;
                    currentFile.changes.push({ type: 'delete', content: line.slice(1) });
                }
            }
        });
        
        return files;
    }

    /**
     * Get repository statistics
     */
    async getStatistics() {
        try {
            const status = await this.getStatus();
            const branches = await this.git.branchLocal();
            const tags = await this.git.tags();
            const log = await this.git.log({ maxCount: 1000 });
            
            // Calculate contributor statistics
            const contributors = {};
            log.all.forEach(commit => {
                const author = commit.author_name;
                contributors[author] = (contributors[author] || 0) + 1;
            });
            
            return {
                success: true,
                currentBranch: this.currentBranch,
                totalBranches: branches.all.length,
                totalTags: tags.all.length,
                totalCommits: log.total,
                contributors: Object.keys(contributors).length,
                topContributors: Object.entries(contributors)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([name, commits]) => ({ name, commits })),
                status: {
                    staged: status.staged.length,
                    modified: status.modified.length,
                    untracked: status.untracked.length
                }
            };
        } catch (error) {
            console.error('Failed to get statistics:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cleanup version control module
     */
    async cleanup() {
        try {
            // Disable auto-commit if enabled
            if (this.autoCommitEnabled) {
                this.disableAutoCommit();
            }

            // Clear data
            this.remotes.clear();
            this.hooks.clear();
            this.stashList = [];
            
            console.log('Version control module cleaned up');
            return { success: true };
        } catch (error) {
            console.error('Failed to cleanup version control module:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = VersionControlModule;