---
name: extension-create
description: "Auto-scaffold Chrome extensions with WXT or Plasmo. Ask user for name/features, scaffold, configure entrypoints. Use when: create extension, scaffold, new extension."
---

# Extension Create (WXT & Plasmo)

Auto-scaffold a Chrome extension project. Do NOT just explain — execute the workflow.

## Workflow (Execute This)

### Step 1: Gather requirements from user

Ask the user to confirm:
1. **Extension name** (kebab-case, e.g. `my-tab-manager`)
2. **Short description** (1 sentence)
3. **UI framework**: React / Vue / Svelte / Vanilla (default: React)
4. **Features needed** (pick from list below):
   - Popup UI
   - Content script (modify pages)
   - Background service worker
   - Side panel
   - Options page
   - Context menu
   - Tab management / Storage / Active tab only

### Step 2: Pick scaffolder based on framework choice

| Framework | Recommended Scaffolder | Why |
|-----------|----------------------|-----|
| React | **Plasmo** or WXT | Plasmo has CSUI, quickstarts |
| Vue | **WXT** | First-class Vue support |
| Svelte | **WXT** | First-class Svelte support |
| Vanilla TS | **WXT** | Lightest setup |

### Step 3: Scaffold

**WXT** — multi-framework, file-based entrypoints:
```bash
npx wxt@latest init <name> --template <react|vue|svelte|vanilla>
cd <name> && pnpm install
```

**Plasmo** — React-first, auto-manifest, rich quickstarts:
```bash
# Basic React
npm create plasmo --with-src
# With Tailwind CSS
npm create plasmo -- --with-tailwindcss
# With specific template (see https://docs.plasmo.com/quickstarts)
npm create plasmo -- --with-redux
```
Quickstarts: https://docs.plasmo.com/quickstarts
Full docs: https://docs.plasmo.com/

### Step 3: Configure based on features

**WXT**: Edit `wxt.config.ts` with permissions and manifest fields.
**Plasmo**: Edit `package.json` manifest section or `plasmo.config.ts`. Plasmo auto-generates manifest from code.

### Step 4: Create entrypoints

Create files in `entrypoints/` based on chosen features (see below).

### Step 5: Verify setup

**WXT**: `pnpm dev` / `pnpm build` / `pnpm zip`
**Plasmo**: `pnpm dev` / `pnpm build` / `pnpm package` (creates zip in `build/`)

---

## Entrypoints Quick Reference

| Feature | WXT | Plasmo |
|---------|-----|--------|
| Popup | `entrypoints/popup/index.html` + `main.tsx` | `src/popup.tsx` |
| Background | `entrypoints/background.ts` | `src/background.ts` |
| Content script | `entrypoints/content.ts` | `src/contents/main.tsx` |
| Options page | `entrypoints/options/index.html` | `src/options.tsx` |
| Side panel | `entrypoints/sidepanel/index.html` | `src/sidepanel.tsx` |
| Tab page | N/A | `src/tabs/settings.tsx` |

---

## wxt.config.ts Template

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-react'],  // or vue/svelte
  manifest: {
    name: 'My Extension',
    description: 'What it does',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
    action: { default_popup: 'popup.html' },
  },
});
```

---

## Extension Type → Entrypoints Map

| Type | Entrypoints | Permissions |
|------|------------|-------------|
| Popup tool | popup | activeTab |
| Page modifier | content, background | activeTab or host_permissions |
| Side panel assistant | sidepanel, background | sidePanel, storage |
| Tab manager | popup, background | tabs, storage |
| Context menu | background | contextMenus, activeTab |

---

## Post-Scaffold Checklist

- [ ] `pnpm install` completed
- [ ] Config has correct permissions (WXT: `wxt.config.ts` / Plasmo: `package.json`)
- [ ] Entrypoints created for chosen features
- [ ] `pnpm dev` loads extension without errors
- [ ] Load unpacked: WXT → `.output/chrome-mv3-dev` / Plasmo → `build/chrome-mv3-dev`

---

## References

- `references/wxt-scaffold-guide.md` — CLI options, project structure, config
- `references/wxt-entrypoints.md` — All entrypoint types, naming, manifest generation
- `references/extension-templates.md` — Ready-to-use patterns per extension type
- `references/chrome-samples-reference.md` — Google's official samples by category

## Related Skills

- `extension-manifest` — Generate/validate manifest.json
- `extension-dev` — Dev workflow, hot reload, debugging
- `extension-publish` — Store submission
