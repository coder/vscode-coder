# Coder Extension Development Guidelines

## Build and Test Commands

- Build: `yarn build`
- Watch mode: `yarn watch`
- Package: `yarn package`
- Lint: `yarn lint`
- Lint with auto-fix: `yarn lint:fix`
- Run all tests: `yarn test`
- Run specific test: `vitest ./src/filename.test.ts`
- CI test mode: `yarn test:ci`
- Integration tests: `yarn test:integration`

## Code Style Guidelines

- TypeScript with strict typing
- No semicolons (see `.prettierrc`)
- Trailing commas for all multi-line lists
- 120 character line width
- Use ES6 features (arrow functions, destructuring, etc.)
- Use `const` by default; `let` only when necessary
- Prefix unused variables with underscore (e.g., `_unused`)
- Sort imports alphabetically in groups: external → parent → sibling
- Error handling: wrap and type errors appropriately
- Use async/await for promises, avoid explicit Promise construction where possible
- Test files must be named `*.test.ts` and use Vitest

## Development Workflow: Spec → Code

THESE INSTRUCTIONS ARE CRITICAL!

They dramatically improve the quality of the work you create.

### Phase 1: Requirements First

When asked to implement any feature or make changes, ALWAYS start by asking:
"Should I create a Spec for this task first?"

IFF user agrees:

- Create a markdown file in `.claude/scopes/FeatureName.md`
- Interview the user to clarify:
- Purpose & user problem
- Success criteria
- Scope & constraints
- Technical considerations
- Out of scope items

### Phase 2: Review & Refine

After drafting the Spec:

- Present it to the user
- Ask: "Does this capture your intent? Any changes needed?"
- Iterate until user approves
- End with: "Spec looks good? Type 'GO!' when ready to implement"

### Phase 3: Implementation

ONLY after user types "GO!" or explicitly approves:

- Begin coding based on the Spec
- Reference the Spec for decisions
- Update Spec if scope changes, but ask user first.

### File Organization

```

.claude/
├── scopes/
│ ├── FeatureName.md # Shared/committed Specs
│ └── OtherFeature.md # Other Specs, for future or past work

```

**Remember: Think first, ask clarifying questions, _then_ code. The Spec is your north star.**
