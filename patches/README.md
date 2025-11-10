# Package Patches

This directory contains patches for packages that use the `navigator` global, which triggers deprecation warnings in VS Code extensions.

All patches are automatically applied during `yarn install` via the `postinstall` script in package.json.

## How to Update Patches

When updating a patched package to a new version:

1. Update the package: `yarn upgrade package-name@x.x.x`
2. Delete the old patch file: `rm patches/package-name+old.version.patch`
3. Manually reapply the changes (documented below) to the new version's files
4. Generate new patch: `npx patch-package package-name`
5. Test: `yarn build && yarn test:ci`

---

## axios

**Why:** Removes `navigator` checks to avoid VS Code deprecation warnings. Axios uses `navigator` to detect browser environments, but this is unnecessary in Node.js-based VS Code extensions.

**What to look for:**
Search for the pattern where `_navigator` is defined. This appears in multiple distribution files.

**Pattern to find:**

<!-- prettier-ignore -->
```javascript
const _navigator = typeof navigator === 'object' && navigator || undefined;
```

**Replace with:**

```javascript
const _navigator = undefined; // PATCHED: Removed navigator check
```

**Files typically modified:**

- `node_modules/axios/dist/node/axios.cjs`
- `node_modules/axios/dist/esm/axios.js`
- `node_modules/axios/lib/platform/common/utils.js`

**Tip:** Search for `const _navigator =` in the axios directory.

---

## zod

**Why:** Removes `navigator` check used for Cloudflare Workers detection. VS Code extensions run in Node.js, not Cloudflare Workers.

**What to look for:**
Search for the `allowsEval` function that checks for Cloudflare in the user agent.

**Pattern to find:**

<!-- prettier-ignore -->
```javascript
if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
}
```

**Replace with:**

```javascript
// PATCHED: Removed navigator check to avoid VS Code deprecation warning
// We're not running in Cloudflare Workers in a VS Code extension
```

**Files typically modified:**

- `node_modules/zod/v4/core/util.js`
- `node_modules/zod/v4/core/util.cjs`

**Tip:** Search for `allowsEval` or `Cloudflare` in the zod directory. Patch both .js and .cjs variants.

---

## openpgp

**Why:** Removes `navigator.hardwareConcurrency` check. Since VS Code extensions run in Node.js, we can use `os.cpus()` directly.

**What to look for:**
Search for the `getHardwareConcurrency` function that checks for `navigator.hardwareConcurrency`.

**Pattern to find:**

```javascript
getHardwareConcurrency: function() {
    if (typeof navigator !== 'undefined') {
        return navigator.hardwareConcurrency || 1;
    }
    const os = this.nodeRequire('os');
    return os.cpus().length;
}
```

**Replace with:**

```javascript
getHardwareConcurrency: function() {
    // PATCHED: Removed navigator check to avoid VS Code deprecation warning
    const os = this.nodeRequire('os');
    return os.cpus().length;
}
```

**Files typically modified:**

- `node_modules/openpgp/dist/openpgp.js`

**Tip:** Search for `getHardwareConcurrency` in the openpgp directory.

---

## node-forge

**Why:** Removes multiple `navigator` checks used for browser detection, hardware concurrency, and entropy collection. VS Code extensions run in Node.js, so these checks are unnecessary.

### Patch 1: Browser detection in jsbn.js

**Pattern to find:**
A conditional block that checks `typeof(navigator)` and sets `BigInteger.prototype.am` based on browser type (Internet Explorer, Netscape, etc.).

**Replace with:**

```javascript
// PATCHED: Removed navigator check to avoid VS Code deprecation warning
BigInteger.prototype.am = am3;
dbits = 28;
```

**Tip:** Search for `navigator.appName` or `BigInteger.prototype.am` in `lib/jsbn.js`.

---

### Patch 2: Entropy collection in random.js

**Pattern to find:**
A block that iterates through `navigator` properties to collect entropy bytes.

<!-- prettier-ignore -->
```javascript
if(typeof(navigator) !== 'undefined') {
    var _navBytes = '';
    for(var key in navigator) {
        // ... entropy collection code
    }
}
```

**Replace with:**

```javascript
// PATCHED: Removed navigator entropy collection to avoid VS Code deprecation warning
```

**Tip:** Search for `_navBytes` or `add some entropy from navigator` in `lib/random.js`.

---

### Patch 3: Hardware concurrency in util.js

**Pattern to find:**
In the `estimateCores` function, a check for `navigator.hardwareConcurrency`.

<!-- prettier-ignore -->
```javascript
if(typeof navigator !== 'undefined' &&
    'hardwareConcurrency' in navigator &&
    navigator.hardwareConcurrency > 0) {
    util.cores = navigator.hardwareConcurrency;
    return callback(null, util.cores);
}
```

**Replace with:**

```javascript
// PATCHED: Removed navigator check to avoid VS Code deprecation warning
```

**Tip:** Search for `estimateCores` or `hardwareConcurrency` in `lib/util.js`.

---

## Verification

After applying patches, verify the build succeeds and tests pass:

```bash
yarn build
yarn test:ci
```

## Notes

- These patches maintain functionality while removing deprecation warnings
- All patches use Node.js implementations directly, which is appropriate for VS Code extensions
- The patches do not affect the security or correctness of the packages
- When in doubt, search for `typeof navigator` in the package directory to find all occurrences
