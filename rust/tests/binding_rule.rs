//! Binding files convert, they do not compute.
//!
//! A method in `src/wasm/*.rs` turns its arguments into core types, makes one call into the
//! core and turns the result back. Geometry that lives in a binding is out of reach for plain
//! Rust and for any other binding.
//!
//! Two measures, both recorded in `tests/binding_rule.txt` and both only allowed to go down:
//!
//! * `file <name> <lines>`: the lines of code a binding file may hold.
//! * `fn <name> <owner>::<function> <lines>`: a function that is still longer than [`LIMIT`].
//!
//! After moving logic into the core, write the new numbers with
//! `BINDING_RULE_UPDATE=1 cargo test --test binding_rule`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Lines of code a binding function may hold without being listed.
const LIMIT: usize = 12;

/// One line with its string literals, character literals and line comment taken out, so that
/// a brace in any of those is not counted as structure.
fn code(line: &str) -> String
{
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len()
    {
        match chars[i]
        {
            '/' if chars.get(i + 1) == Some(&'/') => break,
            '"' =>
            {
                i += 1;
                while i < chars.len() && chars[i] != '"'
                {
                    i += if chars[i] == '\\' { 2 } else { 1 };
                }
            },
            '\'' if chars.get(i + 1) == Some(&'\\') =>
            {
                i += 2;
                while i < chars.len() && chars[i] != '\''
                {
                    i += 1;
                }
            },
            '\'' if chars.get(i + 2) == Some(&'\'') => i += 2,
            c => out.push(c),
        }
        i += 1;
    }
    out
}

/// The name of the function a line declares, if it declares one.
fn function_name(line: &str) -> Option<String>
{
    let rest = ["pub(crate) ", "pub(super) ", "pub ", "const ", "async "]
        .iter()
        .fold(line.trim_start(), |rest, prefix| rest.strip_prefix(prefix).unwrap_or(rest));
    let name: String = rest
        .strip_prefix("fn ")?
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    Some(name)
}

/// The type an `impl` line at column 0 is for.
fn impl_owner(line: &str) -> Option<String>
{
    let rest = line.strip_prefix("impl")?;
    let rest = match rest.strip_prefix('<')
    {
        Some(generic) => generic.split_once('>')?.1,
        None => rest,
    };
    let target = rest.split_once(" for ").map_or(rest, |(_, target)| target);
    let path: String = target
        .trim_start()
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == ':')
        .collect();
    path.rsplit("::").next().map(str::to_string)
}

/// Lines of code in the body of the function declared at `lines[start]`; `None` for a
/// declaration without a body.
fn body_lines(lines: &[String], start: usize) -> Option<usize>
{
    let mut depth = 0i32;
    let mut opened = false;
    let mut count = 0;
    for line in &lines[start..]
    {
        let text = line.trim();
        if !opened && text.contains(';') && !text.contains('{')
        {
            return None;
        }
        if opened && !text.is_empty() && text != "{" && text != "}"
        {
            count += 1;
        }
        if !opened && text.contains('{')
        {
            opened = true;
            let after = text.split_once('{').map_or("", |(_, after)| after).trim();
            count += usize::from(!after.is_empty() && after != "}");
        }
        depth += text.matches('{').count() as i32 - text.matches('}').count() as i32;
        if opened && depth <= 0
        {
            return Some(count);
        }
    }
    Some(count)
}

/// What one binding file holds: its lines of code, and the functions over [`LIMIT`].
fn measure(path: &Path) -> (usize, BTreeMap<String, usize>)
{
    let lines: Vec<String> = fs::read_to_string(path).unwrap().lines().map(code).collect();
    let total = lines.iter().filter(|line| !line.trim().is_empty()).count();
    let mut owner = String::new();
    let mut long = BTreeMap::new();
    for (index, line) in lines.iter().enumerate()
    {
        if let Some(name) = impl_owner(line)
        {
            owner = name;
        }
        let Some(name) = function_name(line) else { continue };
        let scope = if line.starts_with(' ') { owner.as_str() } else { "" };
        let size = body_lines(&lines, index).unwrap_or(0);
        if size > LIMIT
        {
            // Two functions of one name in one owner (cfg variants) share the larger size.
            let entry = long.entry(format!("{scope}::{name}")).or_insert(0);
            *entry = size.max(*entry);
        }
    }
    (total, long)
}

fn binding_files() -> Vec<PathBuf>
{
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/wasm");
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .collect();
    files.sort();
    files
}

/// The current state in the format of `binding_rule.txt`.
fn snapshot() -> String
{
    let measured: Vec<(String, usize, BTreeMap<String, usize>)> = binding_files()
        .iter()
        .map(|path| (path.file_name().unwrap().to_string_lossy().into_owned(), measure(path)))
        .map(|(name, (total, long))| (name, total, long))
        .collect();
    let files = measured.iter().map(|(name, total, _)| format!("file {name} {total}"));
    let functions = measured.iter().flat_map(|(name, _, long)|
    {
        long.iter().map(move |(function, size)| format!("fn {name} {function} {size}"))
    });
    files.chain(functions).map(|line| line + "\n").collect()
}

#[test]
fn bindings_only_convert()
{
    let record = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/binding_rule.txt");
    let current = snapshot();
    if std::env::var_os("BINDING_RULE_UPDATE").is_some()
    {
        fs::write(&record, &current).unwrap();
    }
    let allowed: BTreeMap<String, usize> = fs::read_to_string(&record)
        .unwrap()
        .lines()
        .filter_map(|line| line.rsplit_once(' '))
        .map(|(key, size)| (key.to_string(), size.parse().unwrap()))
        .collect();
    let grown: Vec<String> = current
        .lines()
        .filter_map(|line| line.rsplit_once(' '))
        .map(|(key, size)| (key, size.parse::<usize>().unwrap()))
        .filter(|(key, size)| *size > allowed.get(*key).copied().unwrap_or(0))
        .map(|(key, size)| match allowed.get(key)
        {
            Some(was) => format!("{key}: {size} lines, was {was}"),
            None => format!("{key}: {size} lines, the limit for a binding function is {LIMIT}"),
        })
        .collect();
    assert!(
        grown.is_empty(),
        "logic was added to a binding; it belongs in the core, with the binding calling it:\n  {}",
        grown.join("\n  ")
    );
}
