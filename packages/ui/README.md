# @repo/ui

Generic React components for VS Code webviews. The package is currently
source-consumed by this monorepo; it does not ship a `dist` build yet.

Its stable separation boundary is the public root exports, no monorepo runtime
imports, and component CSS using only semantic `--ui-*` tokens. A future package
build can emit those same entry points without API changes.

## CSS

Import the semantic token mapping and codicon assets once in each real webview
entry point:

```ts
import "@repo/ui/tokens.css";
import "@repo/ui/codicon.css";
```

`tokens.css` is the only layer that references VS Code's injected
`--vscode-*` variables. Components reference `--ui-*` tokens only.
`--ui-background` is the sidebar surface, the common webview host; a webview
hosted in an editor tab or bottom panel uses `--ui-panel-background` instead,
since VS Code gives webviews no host signal to resolve it automatically.

The radius and spacing tokens mirror VS Code's scale (`baseSizes.ts`), but
only the rungs components actually use are declared; add one when a component
needs it. Native menu, button, and hover paddings are hardcoded rather than
scale-derived, so parity-pinned values stay literals.

Component CSS is inherit-first: typography and text color come from the
webview (`font: inherit`), and controls center content with a fixed height
plus the shared `.ui-control` flex base in `components/control.css`.
Line-height and vertical padding math drift off-center with font metrics,
so components avoid them.

Every component forwards `className` and `style` to its root element, and
default rules use single-class specificity, so a consumer class imported
after the library overrides any default (width, height, spacing).

Where VS Code's stable rendering and its Modern UI preview
(`workbench.experimental.modernUI`) diverge, components follow Modern UI,
and new components should too. Webviews get no signal for the setting, so
the default cannot follow the host. Until the design settles,
`data-ui-style="stable"` on the document root restores the stable-parity
menu motion; Storybook's "UI style" toolbar switch toggles it live.

## Overlays

`Tooltip`, `ContextMenu`, and `DropdownMenu` wrap the Radix primitives,
styled to match the native VS Code menu and hover widgets. Menus expose
Radix's compound parts as flat named exports (`DropdownMenuTrigger`,
`DropdownMenuItem`, `DropdownMenuCheckboxItem`, …): checkbox and radio
items show a check in the icon gutter, `*Label` renders a group heading, and
`*Keybinding` renders a shortcut hint. Pass `keys` the same `key`/`mac`/
`win`/`linux` fields as a keybindings contribution to get the current OS's
binding in its native label style (`⇧⌘R` on macOS, `Ctrl+Shift+R`
elsewhere); `formatKeybinding` does the same for other surfaces, such as
tooltips.

`Tooltip` is a single component taking a `content` prop, and requires a
`TooltipProvider` ancestor. Mount one provider per app so that a pointer
moving between nearby triggers skips the show delay, like native hovers.
The delay defaults to 500ms, matching VS Code's `workbench.hover.delay`,
and tooltips stop growing at half the window height.

Overlay content is portalled to `body`, inherits webview typography from
there, and shares the `.ui-overlay` base for stacking, border, shadow,
and scrolling. Menus default to the Modern UI motion: they scale and fade in
from the trigger corner and fade out on close, with Radix holding unmount
until the exit animation ends. High contrast, `forced-colors`, and
`prefers-reduced-motion` are handled.

## Form controls

`Input`, `Textarea`, `Checkbox`, `Select`, and `Field`/`Label` cover forms
the way VS Code's own settings editor does: text field, number field,
checkbox, and dropdown. Richer shapes map onto that vocabulary instead of
getting bespoke widgets — a switch renders as `Checkbox`, a radio group or
slider-bounded number as `Select` or a number `Input`, a multi-select as
stacked `Checkbox`es inside a `Field`.

`Input` and `Textarea` are controlled with `value` and `onChange(next)`;
`Checkbox` uses `checked` and `onChange(next)`. Native-element props and
refs pass through to the control; `className` and `style` target the root.
`Select` wraps `@radix-ui/react-select` and preserves its controlled
(`value` / `onValueChange`) and uncontrolled (`defaultValue`) modes, with
flat compound exports (`SelectTrigger`, `SelectItem`, …), like the menus.
A password `Input` shows a reveal toggle styled like the find widget's
in-field option buttons.

### Field composition

`Field` lays out a semibold `Label`, children, description, and error text.
It does not clone children or require a form context: native elements,
these controls, and third-party controls work the same way. Connect
`htmlFor` to the control's `id`, and pass `descriptionId` / `errorId` to
associate the rendered text using `aria-describedby`. The consumer owns
validation, `aria-invalid`, and when to announce errors.

Use React's `useId` in reusable forms to avoid duplicate IDs:

```tsx
const id = useId();
const descriptionId = `${id}-description`;
const errorId = `${id}-error`;
const invalid = Boolean(error);

<Field
	label="Region"
	htmlFor={id}
	description="Deploy the workspace close to you."
	descriptionId={descriptionId}
	error={error}
	errorId={errorId}
>
	<Input
		id={id}
		value={region}
		onChange={setRegion}
		aria-describedby={invalid ? `${descriptionId} ${errorId}` : descriptionId}
		aria-invalid={invalid}
	/>
</Field>;
```

Apply the same attributes to `SelectTrigger` for a dropdown. For a group
of checkboxes, use a native `fieldset` with a `legend` for the group name
rather than pointing a single label at several controls.

This follows the explicit label/helper-text relationships documented by
MUI and shadcn's separation of field layout from form state. Radix remains
responsible for Select state and keyboard behavior; no additional form
library is required.

## Known gaps

- Overlay shadows are darker than native in dark themes: menus in VS Code
  use `shadow-lg`, which webviews cannot read, so the closest available
  `widget.shadow` stands in.
- Keybinding hints show the contributed defaults the consumer passes, not
  user remaps: VS Code exposes no API for extensions to resolve a command's
  effective keybinding.
- List/selection-row tokens are deferred to the Tree suite (#1037); the
  `--ui-list-focus-*` rungs cover only the select dropdown's row highlight.

## Codicons

`CodiconName` is derived directly from the installed
`@vscode/codicons/dist/metadata.json` keys. TypeScript validates icon names
without a generated source file or a runtime list in the public API.

## Isolation

ESLint rejects `@repo/*` imports and relative cross-package imports in
`packages/ui` TypeScript and TSX source. `react` remains a peer dependency;
the only runtime dependencies are the Radix primitives and
`@vscode/codicons`. Public consumers import from the package root or its
declared CSS exports.

Shared internals are reached through `package.json` subpath imports (`#cx`,
`#codicons`, `#storybook`). These resolve only inside this package and ship
with it, so they survive a standalone NPM split.
