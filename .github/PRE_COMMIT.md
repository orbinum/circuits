# Pre-commit Configuration

This repository uses [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/okonet/lint-staged) to enforce code quality standards before commits.

## What Runs on Pre-commit

### 1. **Code Formatting** (lint-staged)

- **TypeScript/JavaScript files** (`.ts`, `.js`): Auto-formatted with Prettier
- **JSON files**: Auto-formatted with Prettier
- **Markdown files** (`.md`): Auto-formatted with Prettier

### 2. **Circom Linting**

- Validates basic syntax structure in `.circom` files
- Checks for common mistakes (e.g., using `==` instead of `===` in constraints)

### 3. **Tests**

- Runs all test suites to ensure code changes don't break existing functionality
- Tests must pass before commit is allowed

## Commit Message Format

Commits must follow **Conventional Commits** format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Valid Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `build`: Build system changes
- `ci`: CI/CD changes
- `chore`: Maintenance tasks

### Examples:

```bash
feat(circuits): add disclosure circuit with merkle proof
fix(setup): correct proving key generation entropy
docs: update README with installation instructions
refactor(scripts): improve build pipeline error handling
test(merkle): add tests for tree depth validation
```

## Manual Commands

### Format all files:

```bash
npm run format
```

### Check formatting without changes:

```bash
npm run format:check
```

### Lint Circom files:

```bash
npm run lint:circom
```

### Run tests:

```bash
npm test
```

## Skipping Hooks (Not Recommended)

If you absolutely need to skip pre-commit hooks:

```bash
git commit --no-verify -m "your message"
```

⚠️ **Warning**: Only use this in emergencies. It bypasses all quality checks.

## Troubleshooting

### Hooks not running?

```bash
# Reinstall husky
npm run prepare
```

### Permissions issues?

```bash
# Make hooks executable
chmod +x .husky/pre-commit
chmod +x .husky/commit-msg
chmod +x scripts/utils/lint-circom.sh
```

### Tests failing on commit?

- Fix the failing tests before committing
- Ensure all dependencies are installed: `npm install`
- Run tests manually to debug: `npm test`
