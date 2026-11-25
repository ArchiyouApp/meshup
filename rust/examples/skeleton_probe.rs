//! Measures hypercurve's exact straight skeleton on real polygons: does it finish, how fast, and
//! is the result sound. This decides whether the skeleton in `meshup` builds on it; see
//! `docs/rust-first.md`.
//!
//! ```text
//! cargo run --release --example skeleton_probe -- <rings> <out.tsv> [workers] [timeout ms]
//! ```
//!
//! `<rings>` holds one polygon per line, `id;ring|ring|...` with a ring as `x y,x y,...` (first
//! ring the exterior, not closed). Only the exterior is used: the skeleton takes a single loop.
//!
//! Every polygon runs under each policy and in each coordinate form of [`FORMS`], in a child
//! process, so that a run over the time limit or a crash costs one measurement and not the whole
//! probe. `<out.tsv>` gets one line per run; the summary goes to stdout.

use hypercurve::{Contour2, CurveContext, CurvePreviewOptions, StraightSkeleton2};
use std::io::{BufRead, BufReader, Write};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::{Command, Stdio};
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::time::{Duration, Instant};

type Ring = Vec<[f64; 2]>;

/// The coordinate forms a ring is measured in. The geometry is the same up to a millimetre; what
/// differs is the size of the exact numbers the kernel computes with.
///
/// * `rd`: as delivered, national grid metres (six digits before the decimal point).
/// * `local`: moved to an origin at the ring's lower left corner; exact in f64.
/// * `mm`: `local` in whole millimetres, the precision of the source.
/// * `mm-clean`: `mm` without repeated and collinear vertices.
const FORMS: [&str; 4] = ["rd", "local", "mm", "mm-clean"];
/// The policy a run decides signs under. `preview` is the kernel's lossy mode: a sign it cannot certify
/// is read from the f64 value, which the kernel offers for display and not as certified topology.
const POLICIES: [(&str, CurveContext, bool); 3] = [
    ("strict", CurveContext::STRICT, false),
    ("approx512", CurveContext::APPROXIMATE_512, false),
    ("preview", CurveContext::STRICT, true),
];
/// Absolute and relative tolerance of the preview mode.
const PREVIEW_TOLERANCE: (f64, f64) = (1e-9, 1e-12);
const RUNS: usize = FORMS.len() * POLICIES.len();
const HEADER: &str = "index\tid\tvertices\tholes\tform\tpolicy\tstatus\tmicros\tnodes\tarcs\tinside\tcrossings\tcomponents";

struct Polygon
{
    id: String,
    exterior: Ring,
    holes: usize,
}

fn read_polygons(path: &str) -> Vec<Polygon>
{
    let ring = |text: &str| -> Ring
    {
        text.split(',')
            .map(|xy| xy.split_once(' ').expect("a vertex is `x y`"))
            .map(|(x, y)| [x.parse().expect("x"), y.parse().expect("y")])
            .collect()
    };
    std::fs::read_to_string(path)
        .expect("the rings file")
        .lines()
        .filter_map(|line| line.split_once(';'))
        .map(|(id, rings)|
        {
            let rings: Vec<&str> = rings.split('|').collect();
            Polygon { id: id.to_string(), exterior: ring(rings[0]), holes: rings.len() - 1 }
        })
        .collect()
}

fn cross(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64
{
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/// `ring` without vertices that repeat their predecessor or lie on the line through their
/// neighbours. Exact for whole-number coordinates of this size.
fn without_collinear(ring: &Ring) -> Ring
{
    let n = ring.len();
    let kept: Ring = (0..n)
        .filter(|&i| cross(ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]) != 0.0)
        .map(|i| ring[i])
        .collect();
    if kept.len() == n || kept.len() < 3 { kept } else { without_collinear(&kept) }
}

fn in_form(ring: &Ring, form: &str) -> Ring
{
    let low = |axis: usize| ring.iter().map(|p| p[axis]).fold(f64::INFINITY, f64::min).floor();
    let origin = [low(0), low(1)];
    let local: Ring = ring.iter().map(|p| [p[0] - origin[0], p[1] - origin[1]]).collect();
    let millimetres = || local.iter().map(|p| [(p[0] * 1000.0).round(), (p[1] * 1000.0).round()]).collect();
    match form
    {
        "rd" => ring.clone(),
        "local" => local,
        "mm" => millimetres(),
        _ => without_collinear(&millimetres()),
    }
}

/// The variant name of a `Debug` value, without its fields.
fn variant(value: &impl std::fmt::Debug) -> String
{
    format!("{value:?}").split([' ', '{', '(']).next().unwrap_or("").to_string()
}

fn distance_to_segment(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64
{
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length2 = dx * dx + dy * dy;
    let t = if length2 > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2).clamp(0.0, 1.0) } else { 0.0 };
    ((p[0] - a[0] - t * dx).powi(2) + (p[1] - a[1] - t * dy).powi(2)).sqrt()
}

fn inside_or_on(p: [f64; 2], ring: &Ring, tolerance: f64) -> bool
{
    let edges = || (0..ring.len()).map(|i| (ring[i], ring[(i + 1) % ring.len()]));
    let crossings = edges()
        .filter(|(a, b)| (a[1] > p[1]) != (b[1] > p[1]))
        .filter(|(a, b)| p[0] < a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]))
        .count();
    crossings % 2 == 1 || edges().any(|(a, b)| distance_to_segment(p, a, b) <= tolerance)
}

/// What a finished skeleton looks like in f64: `(nodes, arcs, all nodes inside, crossing arc pairs,
/// connected components)`. A sound skeleton of one loop is a tree: one component, no crossings.
fn inspect(skeleton: &StraightSkeleton2, ring: &Ring) -> (usize, usize, bool, usize, usize)
{
    let points: Vec<[f64; 2]> = skeleton
        .nodes()
        .iter()
        .map(|node| [node.point().x().to_f64_lossy().unwrap_or(f64::NAN), node.point().y().to_f64_lossy().unwrap_or(f64::NAN)])
        .collect();
    let arcs: Vec<(usize, usize)> = skeleton.arcs().iter().map(|arc| (arc.start_node(), arc.end_node())).collect();
    let extent = |axis: usize| ring.iter().map(|p| p[axis]).fold(0.0, f64::max) - ring.iter().map(|p| p[axis]).fold(f64::INFINITY, f64::min);
    let size = extent(0).hypot(extent(1));
    let inside = points.iter().all(|p| inside_or_on(*p, ring, 1e-7 * size));
    let apart = 1e-9 * size * size;
    let crosses = |(a, b): (usize, usize), (c, d): (usize, usize)|
    {
        let shared = a == c || a == d || b == c || b == d;
        let (o1, o2) = (cross(points[a], points[b], points[c]), cross(points[a], points[b], points[d]));
        let (o3, o4) = (cross(points[c], points[d], points[a]), cross(points[c], points[d], points[b]));
        !shared && [o1, o2, o3, o4].iter().all(|o| o.abs() > apart) && o1 * o2 < 0.0 && o3 * o4 < 0.0
    };
    let crossings = (0..arcs.len())
        .map(|i| (i + 1..arcs.len()).filter(|&j| crosses(arcs[i], arcs[j])).count())
        .sum();
    let mut parent: Vec<usize> = (0..points.len()).collect();
    fn root(parent: &mut [usize], i: usize) -> usize
    {
        if parent[i] == i { i } else { let r = root(parent, parent[i]); parent[i] = r; r }
    }
    arcs.iter().for_each(|&(a, b)|
    {
        let (ra, rb) = (root(&mut parent, a), root(&mut parent, b));
        parent[ra] = rb;
    });
    let components = (0..points.len()).filter(|&i| root(&mut parent, i) == i).count();
    (points.len(), arcs.len(), inside, crossings, components)
}

fn line(index: usize, polygon: &Polygon, run: usize, vertices: usize, rest: &str) -> String
{
    let (form, policy) = (FORMS[run / POLICIES.len()], POLICIES[run % POLICIES.len()].0);
    format!("{index}\t{}\t{vertices}\t{}\t{form}\t{policy}\t{rest}", polygon.id, polygon.holes)
}

/// One measurement: build the contour and its skeleton, timed together.
fn measure(index: usize, polygon: &Polygon, run: usize) -> String
{
    let ring = in_form(&polygon.exterior, FORMS[run / POLICIES.len()]);
    let (_, policy, preview) = POLICIES[run % POLICIES.len()];
    let started = Instant::now();
    let result = catch_unwind(AssertUnwindSafe(||
    {
        let contour = Contour2::from_finite_ring(&ring)?;
        if !preview
        {
            return contour.straight_skeleton(&policy);
        }
        CurvePreviewOptions::try_new(policy, PREVIEW_TOLERANCE.0, PREVIEW_TOLERANCE.1)?
            .evaluate(|lossy| contour.straight_skeleton(lossy))
    }));
    let micros = started.elapsed().as_micros();
    let rest = match result
    {
        Err(_) => format!("panic\t{micros}\t0\t0\t0\t0\t0"),
        Ok(Err(error)) => format!("error:{}\t{micros}\t0\t0\t0\t0\t0", variant(&error)),
        Ok(Ok(evidence)) => match (evidence.skeleton(), evidence.blocker())
        {
            (Some(skeleton), _) =>
            {
                let (nodes, arcs, inside, crossings, components) = inspect(skeleton, &ring);
                format!("ok\t{micros}\t{nodes}\t{arcs}\t{}\t{crossings}\t{components}", u8::from(inside))
            },
            (None, Some(blocker)) =>
            {
                // The stage and the number of events handled say how far the kernel got.
                let reached = format!("{:?}/{}", evidence.stage(), evidence.event_count().min(1));
                format!("{}@{reached}\t{micros}\t0\t0\t0\t0\t0", variant(blocker))
            },
            (None, None) => format!("no-skeleton\t{micros}\t0\t0\t0\t0\t0"),
        },
    };
    line(index, polygon, run, ring.len(), &rest)
}

/// Child process: the runs of polygons `from..to`, the first `skip` runs of `from` left out.
fn work(polygons: &[Polygon], from: usize, to: usize, skip: usize)
{
    std::panic::set_hook(Box::new(|_| {}));
    let mut out = std::io::stdout().lock();
    (from..to)
        .flat_map(|index| (0..RUNS).map(move |run| (index, run)))
        .skip(skip)
        .for_each(|(index, run)|
        {
            writeln!(out, "{}", measure(index, &polygons[index], run)).unwrap();
            out.flush().unwrap();
        });
}

/// Run polygons `from..to` in child processes; a child that is silent for `limit` is killed and
/// its run recorded as `timeout`, one that dies as `crash`, and the next child goes on after it.
fn drive(path: &str, polygons: &[Polygon], from: usize, to: usize, limit: Duration) -> Vec<String>
{
    let mut lines = Vec::new();
    let mut at = from * RUNS;
    while at < to * RUNS
    {
        let args = ["--worker", path, &(at / RUNS).to_string(), &to.to_string(), &(at % RUNS).to_string()];
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("the worker process");
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let (sender, receiver) = channel();
        std::thread::spawn(move || stdout.lines().map_while(Result::ok).for_each(|l| { let _ = sender.send(l); }));
        let lost = loop
        {
            match receiver.recv_timeout(limit)
            {
                Ok(text) => { lines.push(text); at += 1; },
                Err(RecvTimeoutError::Timeout) => break "timeout",
                Err(RecvTimeoutError::Disconnected) => break "crash",
            }
        };
        let _ = child.kill();
        let _ = child.wait();
        if at < to * RUNS
        {
            let polygon = &polygons[at / RUNS];
            let rest = format!("{lost}\t{}\t0\t0\t0\t0\t0", limit.as_micros());
            lines.push(line(at / RUNS, polygon, at % RUNS, polygon.exterior.len(), &rest));
            at += 1;
        }
    }
    lines
}

struct Record
{
    vertices: usize,
    form: String,
    policy: String,
    status: String,
    millis: f64,
    sound: bool,
}

fn record(text: &str) -> Record
{
    let f: Vec<&str> = text.split('\t').collect();
    Record {
        vertices: f[2].parse().unwrap(),
        form: f[4].to_string(),
        policy: f[5].to_string(),
        status: f[6].to_string(),
        millis: f[7].parse::<f64>().unwrap() / 1000.0,
        sound: f[10] == "1" && f[11] == "0" && f[12] == "1",
    }
}

/// `| n | completed | unsound | median | p90 | p99 | max |` of a set of runs, times in ms.
fn cells(records: &[&Record]) -> String
{
    if records.is_empty()
    {
        return "| 0 | | | | | | |".to_string();
    }
    let mut times: Vec<f64> = records.iter().map(|r| r.millis).collect();
    times.sort_by(f64::total_cmp);
    let at = |q: f64| times[((times.len() - 1) as f64 * q).round() as usize];
    let share = |count: usize| 100.0 * count as f64 / records.len() as f64;
    let completed = records.iter().filter(|r| r.status == "ok").count();
    let unsound = records.iter().filter(|r| r.status == "ok" && !r.sound).count();
    format!(
        "| {} | {:.2} % | {} | {:.3} | {:.3} | {:.3} | {:.1} |",
        records.len(), share(completed), unsound, at(0.5), at(0.9), at(0.99), at(1.0)
    )
}

fn summarise(polygons: &[Polygon], records: &[Record])
{
    let with_holes = polygons.iter().filter(|p| p.holes > 0).count();
    println!("{} polygons, {} with holes ({:.2} %)\n", polygons.len(), with_holes, 100.0 * with_holes as f64 / polygons.len() as f64);
    let buckets: [(&str, usize, usize); 6] =
        [("all", 0, usize::MAX), ("4-40", 4, 40), ("3-4", 3, 4), ("5-8", 5, 8), ("9-16", 9, 16), ("17-40", 17, 40)];
    println!("| form | policy | vertices | runs | completed | unsound | median ms | p90 ms | p99 ms | max ms |");
    println!("|---|---|---|---|---|---|---|---|---|---|");
    FORMS.iter().flat_map(|form| POLICIES.iter().map(move |(policy, _, _)| (*form, *policy))).for_each(|(form, policy)|
    {
        let runs: Vec<&Record> = records.iter().filter(|r| r.form == form && r.policy == policy).collect();
        buckets.iter().for_each(|(name, low, high)|
        {
            let part: Vec<&Record> = runs.iter().copied().filter(|r| (*low..=*high).contains(&r.vertices)).collect();
            println!("| {form} | {policy} | {name} | {}", cells(&part).trim_start_matches("| "));
        });
        let part: Vec<&Record> = runs.iter().copied().filter(|r| r.vertices > 40).collect();
        println!("| {form} | {policy} | 41+ | {}", cells(&part).trim_start_matches("| "));
    });
    println!("\n| form | policy | outcome | runs | share |");
    println!("|---|---|---|---|---|");
    FORMS.iter().flat_map(|form| POLICIES.iter().map(move |(policy, _, _)| (*form, *policy))).for_each(|(form, policy)|
    {
        let runs: Vec<&Record> = records.iter().filter(|r| r.form == form && r.policy == policy).collect();
        let mut outcomes: Vec<&str> = runs.iter().map(|r| r.status.as_str()).collect();
        outcomes.sort_unstable();
        outcomes.dedup();
        outcomes.iter().for_each(|outcome|
        {
            let count = runs.iter().filter(|r| r.status == *outcome).count();
            println!("| {form} | {policy} | {outcome} | {count} | {:.2} % |", 100.0 * count as f64 / runs.len() as f64);
        });
    });
}

fn main()
{
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--worker")
    {
        let number = |i: usize| args[i].parse::<usize>().expect("a number");
        return work(&read_polygons(&args[1]), number(2), number(3), number(4));
    }
    let (path, out) = (args.first().expect("the rings file"), args.get(1).expect("the output file"));
    let workers: usize = args.get(2).map_or(8, |n| n.parse().expect("workers"));
    let limit = Duration::from_millis(args.get(3).map_or(5000, |n| n.parse().expect("timeout in ms")));
    let polygons = read_polygons(path);
    let step = polygons.len().div_ceil(workers).max(1);
    let lines: Vec<String> = std::thread::scope(|scope|
    {
        let handles: Vec<_> = (0..polygons.len())
            .step_by(step)
            .map(|from| (from, (from + step).min(polygons.len())))
            .map(|(from, to)| { let polygons = &polygons; scope.spawn(move || drive(path, polygons, from, to, limit)) })
            .collect();
        handles.into_iter().flat_map(|handle| handle.join().expect("a driver thread")).collect()
    });
    std::fs::write(out, format!("{HEADER}\n{}\n", lines.join("\n"))).expect("the output file");
    summarise(&polygons, &lines.iter().map(|text| record(text)).collect::<Vec<_>>());
}
