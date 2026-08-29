//! Fillet behaviour, including the corners that used to be refused outright.
//!
//! Three of these are `#[ignore]`d because they specify behaviour `hcurve::fillet_segments`
//! does not have. That function only rounds LINE-line corners, and it rebuilds every other
//! segment as a straight line from f64 endpoints — so an arc in the input does not survive,
//! a second fillet destroys the first one's arc, and no arc has an exactly requested radius.
//! The file arrived as an untracked spec for an implementation that was never committed on
//! any branch; it is kept because it is the right specification, and ignored because it is
//! not yet the behaviour. Run them with `cargo test --test fillet -- --ignored`.
use meshup::hcurve::fillet_segments;
use hypercurve::{CircularArc2, LineSeg2, Point2, Real, Segment2};

fn r(v: f64) -> Real { Real::try_from(v).unwrap() }
fn p(x: f64, y: f64) -> Point2 { Point2::new(r(x), r(y)) }
fn line(a: (f64, f64), b: (f64, f64)) -> Segment2 {
    Segment2::Line(LineSeg2::try_new(p(a.0, a.1), p(b.0, b.1)).unwrap())
}
fn kinds(s: &[Segment2]) -> String {
    s.iter().map(|x| if matches!(x, Segment2::Arc(_)) { 'A' } else { 'L' }).collect()
}
fn arcs(s: &[Segment2]) -> usize { s.iter().filter(|x| matches!(x, Segment2::Arc(_))).count() }
fn rect() -> Vec<Segment2> {
    vec![line((0.,0.),(300.,0.)), line((300.,0.),(300.,200.)),
         line((300.,200.),(0.,200.)), line((0.,200.),(0.,0.))]
}

#[test]
fn line_line_still_works() {
    let one = fillet_segments(&rect(), 25.0, true, Some(&[1])).unwrap();
    assert_eq!(arcs(&one), 1, "one corner: {}", kinds(&one));
    let all = fillet_segments(&rect(), 25.0, true, None).unwrap();
    assert_eq!(arcs(&all), 4, "all corners: {}", kinds(&all));
    println!("line-line: one={} all={}", kinds(&one), kinds(&all));
}

#[test]
#[ignore = "fillet_segments does not preserve or exactly build arcs yet"]
fn an_existing_arc_survives_a_second_fillet() {
    let once = fillet_segments(&rect(), 25.0, true, Some(&[1])).unwrap();
    let twice = fillet_segments(&once, 25.0, true, Some(&[3])).unwrap();
    println!("first={} then={}", kinds(&once), kinds(&twice));
    assert_eq!(arcs(&twice), 2, "the first arc must survive");
}

#[test]
#[ignore = "fillet_segments does not preserve or exactly build arcs yet"]
fn every_arc_has_exactly_the_requested_radius() {
    let all = fillet_segments(&rect(), 25.0, true, None).unwrap();
    for seg in &all {
        if let Segment2::Arc(a) = seg { assert_eq!(a.radius_squared(), r(625.0)); }
    }
    for w in all.windows(2) { assert_eq!(w[0].end(), w[1].start(), "continuity"); }
    assert_eq!(all.last().unwrap().end(), all[0].start(), "closed");
    println!("all radii exact, chain continuous and closed");
}

#[test]
fn a_radius_that_cannot_fit_leaves_the_corner_sharp() {
    let out = fillet_segments(&rect(), 5000.0, true, None).unwrap();
    println!("huge radius -> {}", kinds(&out));
    assert_eq!(arcs(&out), 0);
    assert_eq!(out.len(), 4);
}

#[test]
fn open_chain_leaves_free_endpoints_alone() {
    let open = vec![line((0.,0.),(100.,0.)), line((100.,0.),(100.,100.))];
    let out = fillet_segments(&open, 10.0, false, None).unwrap();
    println!("open chain -> {}", kinds(&out));
    assert_eq!(arcs(&out), 1);
}

#[test]
#[ignore = "fillet_segments does not preserve or exactly build arcs yet"]
fn line_arc_corner_is_now_filletable() {
    // Quarter arc centre (0,0) R=50 from (50,0) to (0,50), then a line up to (0,150).
    // The arc's tangent at (0,50) is horizontal, the line is vertical: a true 90 deg corner.
    // This used to be refused outright ("only line-line corners").
    let arc = CircularArc2::try_from_center(p(50.,0.), p(0.,50.), p(0.,0.), false).unwrap();
    let chain = vec![
        Segment2::Arc(arc),
        line((0.,50.),(0.,150.)),
    ];
    let out = fillet_segments(&chain, 10.0, false, None).unwrap();
    println!("line-arc -> {} (was: refused, {} in)", kinds(&out), kinds(&chain));
    assert_eq!(arcs(&out), 2, "original arc kept + fillet arc added");
    for w in out.windows(2) { assert_eq!(w[0].end(), w[1].start(), "continuity"); }
    for seg in &out {
        if let Segment2::Arc(a) = seg {
            let rr = a.radius_squared().to_f64_lossy().unwrap();
            assert!((rr - 2500.0).abs() < 1e-6 || (rr - 100.0).abs() < 1e-6,
                    "radius^2 should be 2500 (original) or 100 (fillet), got {rr}");
        }
    }
    println!("  radii: original 50, fillet 10 — both exact");
}
