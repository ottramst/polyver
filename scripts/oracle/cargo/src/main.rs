// Cargo oracle, run by run.sh with the semver crate pinned in Cargo.lock.
// Usage: polyver-oracle <versions> <pairs> <requirements> <validity-out> <pairs-out> <requirements-out>
// A version is valid if Version::parse accepts it; each pair of valid versions is written as
// `a <op> b` using Version's Ord, which breaks ties between equal versions by build metadata. Each
// `version<TAB>quoted<TAB>requirement` row with a valid version is written as
// `version satisfies|fails quoted` using VersionReq::matches, and each requirement that
// VersionReq::parse rejects as `rejects quoted`, where `quoted` is the requirement as generate.ts quotes
// it (JSON if it has unusual whitespace).
use semver::{Version, VersionReq};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufWriter, Write};

fn lines(path: &str) -> Vec<String> {
    let text = fs::read_to_string(path).unwrap();
    text.strip_suffix('\n').unwrap_or(&text).split('\n').map(String::from).collect()
}

fn create(path: &str) -> BufWriter<fs::File> {
    BufWriter::new(fs::File::create(path).unwrap())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut valid = HashMap::new();
    let mut out = create(&args[4]);
    for v in lines(&args[1]) {
        let ok = Version::parse(&v).is_ok();
        writeln!(out, "{} {}", if ok { "valid" } else { "invalid" }, v).unwrap();
        valid.insert(v, ok);
    }
    out.flush().unwrap();

    let mut out = create(&args[5]);
    for line in lines(&args[2]) {
        let (a, b) = line.split_once(' ').unwrap();
        if !valid[a] || !valid[b] {
            continue;
        }
        let op = match Version::parse(a).unwrap().cmp(&Version::parse(b).unwrap()) {
            Ordering::Less => "<",
            Ordering::Equal => "=",
            Ordering::Greater => ">",
        };
        writeln!(out, "{} {} {}", a, op, b).unwrap();
    }
    out.flush().unwrap();

    let mut out = create(&args[6]);
    let mut rejected = HashSet::new();
    for line in lines(&args[3]) {
        // `version<TAB>quoted<TAB>requirement`: a requirement may contain tabs, but the version and
        // its quoted form (written to the output) never do.
        let (v, rest) = line.split_once('\t').unwrap();
        let (quoted, req) = rest.split_once('\t').unwrap();
        let Ok(parsed) = VersionReq::parse(req) else {
            if rejected.insert(quoted.to_string()) {
                writeln!(out, "rejects {}", quoted).unwrap();
            }
            continue;
        };
        if let Ok(version) = Version::parse(v) {
            let verdict = if parsed.matches(&version) { "satisfies" } else { "fails" };
            writeln!(out, "{} {} {}", v, verdict, quoted).unwrap();
        }
    }
    out.flush().unwrap();
}
