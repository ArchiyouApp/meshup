# Coding Agents — Style Guide

## Formatting: Allman Brace Style

All code contributions **must** use [Allman style](https://en.wikipedia.org/wiki/Indentation_style#Allman_style) — opening braces on their **own line**, at the same indentation level as the statement that owns them.

### TypeScript / JavaScript

```ts
// ✅ correct
if (condition)
{
    doSomething();
}

function foo(x: number): string
{
    return String(x);
}

class MyClass
{
    constructor()
    {
        // ...
    }

    myMethod(): void
    {
        if (true)
        {
            // ...
        }
    }
}

// ❌ wrong
if (condition) {
    doSomething();
}
```

### Rust

```rust
// ✅ correct
fn my_function(x: usize) -> usize
{
    if x > 0
    {
        x + 1
    }
    else
    {
        0
    }
}

impl MyStruct
{
    pub fn new() -> Self
    {
        Self { value: 0 }
    }
}

// ❌ wrong
fn my_function(x: usize) -> usize {
    if x > 0 {
        x + 1
    } else {
        0
    }
}
```

## Indentation

- **4 spaces** for both TypeScript and Rust.
- No tabs.

## Blank Lines

- One blank line between methods/functions.
- One blank line after opening brace of `class` / `impl` blocks.
- Section comments (`//// SECTION ////`) are preceded by **two** blank lines.

## Comments

- Use `//` line comments, not `/* */` block comments, for inline documentation.
- Use `/** ... */` JSDoc only for public TypeScript API.
- Use `/// ...` rustdoc only for public Rust API.
- Section headers use the pattern: `//// SECTION NAME ////`

## Naming

| Context | Convention |
|---|---|
| TS classes | `PascalCase` |
| TS methods / variables | `camelCase` |
| Rust structs / enums | `PascalCase` |
| Rust functions / methods | `snake_case` |
| WASM JS export names (`js_name`) | `camelCase` |
| Constants | `SCREAMING_SNAKE_CASE` |

## Miscellaneous

- Always use `this` (not aliased) in TypeScript class methods.
- Prefer `early return` / guard clauses over deeply nested `if` blocks.
- `match` arms in Rust: wrap multi-line arms in `{}` on their own line.
- Trailing commas: **yes** in TypeScript, follow `rustfmt` defaults in Rust.