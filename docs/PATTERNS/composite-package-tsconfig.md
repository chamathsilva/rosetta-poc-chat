# Composite Package tsconfig

## Name
Composite Package tsconfig

## Description
Each package has `tsconfig.json` extending `../../tsconfig.base.json` with `composite: true`, `rootDir: src`, an `outDir`, and an `include` of `src/**`. The root `tsconfig.json` has `files: []` and lists every package under `references`. Node-targeted packages (api, shared) use `NodeNext` and `declaration: true`. The browser package (web) uses `Bundler`, DOM libs and `jsx`.

## Template
```jsonc
// <package>/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,            // EXTENSION: node/library variant (api, shared)
    "module": "NodeNext",           // EXTENSION: web uses "ESNext" + moduleResolution "Bundler"
    "moduleResolution": "NodeNext",
    // "lib": ["ES2024", "DOM", "DOM.Iterable"], "jsx": "react-jsx"  // EXTENSION: web only
    "rootDir": "src",
    "outDir": "dist"                // EXTENSION: web uses "dist/types"
  },
  "include": ["src/**/*.ts"]        // EXTENSION: web adds "src/**/*.tsx"
}

// root tsconfig.json: register each new package
{ "files": [], "references": [ { "path": "./apps/api" } /* EXTENSION: add new package path */ ] }
```

## Sources
- apps/api/tsconfig.json
- packages/shared/tsconfig.json
- apps/web/tsconfig.json
- tsconfig.json
