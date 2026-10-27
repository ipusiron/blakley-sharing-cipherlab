"""Local browser gates; no install, server, or CI browser dependency is required.

Run with an existing Python environment that contains Playwright:
    python test/interface.browser.py --stage 1a
    python test/interface.browser.py --stage 1a --url http://127.0.0.1:8000/
Results and viewport screenshots are written below .work.
"""
import argparse
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from itertools import product
from datetime import datetime, timedelta, timezone
import json
import re
from pathlib import Path
import sys
from threading import Thread
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PREFIX = "blakley-sharing-cipherlab."
TABS = ("intersections", "compare", "pitfalls")
LABELS = {
    "ja": ("交点で追う", "Shamir と並べる", "確かめる"),
    "en": ("Intersections", "Compare with Shamir", "Pitfalls"),
}
CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; base-uri 'none'; form-action 'none'; "
    "frame-src 'none'; object-src 'none'; connect-src 'none'"
)
PROBE = """() => {
  const visible = el => el.getClientRects().length > 0;
  const label = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
  const px = n => Math.round(n * 1000) / 1000;
  const size = el => ({w: px(el.getBoundingClientRect().width),
    h: px(Math.min(...Array.from(el.getClientRects(), rect => rect.height)))});
  const target = el => {
    if (!el.matches('input[type="radio"], input[type="checkbox"]')) return el;
    return Array.from(el.labels).filter(visible).find(item => {
      const bounds = size(item); return bounds.w >= 44 && bounds.h >= 44;
    }) || el;
  };
  const inline = el => el.tagName === 'A' && el.parentElement &&
    el.parentElement.textContent.trim() !== el.textContent.trim();
  const small = Array.from(document.querySelectorAll(
    'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"]'))
    .filter(visible).filter(el => !inline(el)).map(el => ({
      el: label(el), target: label(target(el)), ...size(target(el))
    })).filter(item => item.w < 44 || item.h < 44);
  const wraps = Array.from(document.querySelectorAll('body *')).filter(visible)
    .filter(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
    .filter(el => el.scrollWidth > el.clientWidth).map(el => ({
      el: label(el), width: el.clientWidth, scroll: el.scrollWidth
    }));
  const tabMetrics = Array.from(document.querySelectorAll('[role="tab"]'), el => {
    const css = getComputedStyle(el), range = document.createRange();
    range.selectNodeContents(el);
    return {el: label(el), size: parseFloat(css.fontSize),
      line: parseFloat(css.lineHeight), height: range.getBoundingClientRect().height};
  });
  return {
    viewport: innerWidth, client: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    rootOverflow: getComputedStyle(document.documentElement).overflowX,
    bodyOverflow: getComputedStyle(document.body).overflowX,
    small, wraps, tabMetrics
  };
}"""


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def set_language_query(url, value):
    parts = urlsplit(url)
    query = [(key, item) for key, item in parse_qsl(parts.query) if key != "lang"]
    if value is not None:
        query.append(("lang", value))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def observe(page, url):
    errors = []
    allowed = urlsplit(url)

    def request_sent(request):
        target = urlsplit(request.url)
        if target.scheme in ("http", "https") and (
            target.scheme != allowed.scheme or target.netloc != allowed.netloc
        ):
            errors.append("Unexpected network request: " + request.url)

    page.on("pageerror", lambda error: errors.append("pageerror: " + str(error)))
    page.on("console", lambda message: errors.append("console: " + message.text)
            if message.type == "error" else None)
    page.on("requestfailed", lambda request: errors.append(
        "requestfailed: " + request.url + " " + str(request.failure)))
    page.on("request", request_sent)
    page.add_init_script("""window.__qaCspViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        window.__qaCspViolations.push({
          directive: event.violatedDirective, blocked: event.blockedURI
        });
      });""")
    return errors


def assert_clean(page, errors):
    violations = page.evaluate("() => window.__qaCspViolations")
    check(not errors, errors)
    check(not violations, violations)


def assert_layout(page, width, name, results):
    measured = page.evaluate(PROBE)
    check(measured["viewport"] == width, (name, measured))
    check(measured["page"] <= measured["client"], (name, measured))
    check(measured["rootOverflow"] not in ("hidden", "clip"), (name, measured))
    check(measured["bodyOverflow"] not in ("hidden", "clip"), (name, measured))
    check(not measured["small"], (name, measured["small"]))
    for tab in measured["tabMetrics"]:
        check(tab["size"] >= 14, (name, tab))
        check(tab["height"] <= tab["line"] * 2 + 1, (name, tab))
    results.append({"state": name, **measured})


def assert_selected(page, name):
    for tab_name in TABS:
        selected = tab_name == name
        tab = page.locator("#tab-" + tab_name)
        panel = page.locator("#panel-" + tab_name)
        check(tab.get_attribute("aria-selected") == str(selected).lower(), tab_name)
        check(tab.get_attribute("tabindex") == ("0" if selected else "-1"), tab_name)
        check(tab.get_attribute("aria-controls") == "panel-" + tab_name, tab_name)
        check(panel.get_attribute("aria-labelledby") == "tab-" + tab_name, tab_name)
        check(panel.is_visible() == selected, tab_name)


def assert_preference(page, language, theme):
    check(page.locator("html").get_attribute("lang") == language, "language " + language)
    check(page.locator("html").get_attribute("data-theme") == theme, "theme " + theme)
    labels = tuple(page.locator("#tab-" + tab).inner_text() for tab in TABS)
    check(labels == LABELS[language], labels)
    for control in ("theme", "language", "help"):
        check(bool(page.locator("#" + control).get_attribute("aria-label")), control)


def test_tabs(page, width, layouts):
    check(page.locator('[role="tablist"]').count() == 1, "one tablist")
    check(page.locator('[role="tab"]').count() == 3, "three tabs")
    check(page.locator('[role="tabpanel"]').count() == 3, "three panels")
    assert_selected(page, "intersections")
    for name in TABS:
        page.locator("#tab-" + name).click()
        assert_selected(page, name)
        assert_layout(page, width, "tab-" + name, layouts)
    page.locator("#tab-pitfalls").focus()
    for key, name in (
        ("ArrowRight", "intersections"), ("ArrowLeft", "pitfalls"),
        ("Home", "intersections"), ("End", "pitfalls"),
        ("ArrowLeft", "compare"), ("ArrowLeft", "intersections"),
    ):
        page.keyboard.press(key)
        assert_selected(page, name)
        focus = page.locator("#tab-" + name).evaluate("""el => {
          const css = getComputedStyle(el);
          return {active: document.activeElement === el, style: css.outlineStyle,
            width: parseFloat(css.outlineWidth)};
        }""")
        check(focus["active"] and focus["style"] != "none" and focus["width"] > 0, focus)


def test_help(page, width, layouts, screenshot):
    page.locator("#help").focus()
    page.keyboard.press("Enter")
    dialog = page.locator("#help-dialog")
    check(dialog.is_visible(), "help is visible")
    check(dialog.evaluate("el => el.open && el.matches(':modal')"), "modal dialog")
    check(dialog.get_attribute("aria-labelledby") == "help-title", "help title")
    check(bool(page.locator("#help-title").inner_text()), "translated help title")
    for key in ("Tab", "Tab", "Shift+Tab"):
        page.keyboard.press(key)
        check(dialog.evaluate("el => el.contains(document.activeElement)"), "dialog focus trap")
    assert_layout(page, width, "help-open", layouts)
    box = dialog.bounding_box()
    check(box["x"] >= 0 and box["x"] + box["width"] <= width + 0.5, box)
    page.screenshot(path=str(screenshot), full_page=False)
    page.keyboard.press("Escape")
    check(not dialog.is_visible(), "Escape closes help")
    check(page.locator("#help").evaluate("el => el === document.activeElement"), "help focus restored")
    page.keyboard.press("Enter")
    page.locator("#close-help").click()
    check(not dialog.is_visible(), "close button closes help")
    check(page.locator("#help").evaluate("el => el === document.activeElement"), "close focus restored")


def test_preferences_interaction(page, language, theme):
    other_language = "en" if language == "ja" else "ja"
    other_theme = "dark" if theme == "light" else "light"
    page.locator("#tab-compare").click()
    original_url = page.url
    page.locator("#language").click()
    page.locator("#theme").click()
    assert_preference(page, other_language, other_theme)
    assert_selected(page, "compare")
    check(page.url == original_url, "preference controls changed URL")
    saved = page.evaluate("() => Object.fromEntries(Object.entries(localStorage))")
    check(saved == {PREFIX + "language": other_language, PREFIX + "theme": other_theme}, saved)
    page.reload()
    assert_preference(page, other_language, other_theme)
    assert_selected(page, "intersections")
    return saved


def open_ancestors(locator):
    """Open existing details through their summary controls, from the outside in."""
    for details in locator.locator("xpath=ancestor::details").all():
        if not details.evaluate("el => el.open"):
            details.locator(":scope > summary").click()


def show_details(page, identifier):
    details = page.locator("#" + identifier)
    open_ancestors(details)
    if not details.evaluate("el => el.open"):
        details.locator(":scope > summary").click()


def click_visible(page, identifier):
    locator = page.locator("#" + identifier)
    open_ancestors(locator)
    locator.click()


def point_data(page, identifier):
    raw = page.locator("#" + identifier).get_attribute("data-points")
    check(raw is not None, identifier + " has data-points")
    return json.loads(raw)


def sorted_points(points):
    return sorted(tuple(point) for point in points)


def selected_shares(page):
    return page.locator("#share-picks [aria-pressed='true']").count()


def choose_shares(page, indices):
    for index, button in enumerate(page.locator("#share-picks button").all()):
        if (button.get_attribute("aria-pressed") == "true") != (index in indices):
            button.click()


def feature_layout(page, width, name, layouts, identifiers):
    assert_layout(page, width, name, layouts)
    for identifier in identifiers:
        locator = page.locator("#" + identifier)
        if not locator.is_visible():
            continue
        bounds = locator.evaluate("""el => {
          const box = el.getBoundingClientRect();
          return {width: box.width, left: box.left, right: box.right,
            client: el.clientWidth, scroll: el.scrollWidth};
        }""")
        check(bounds["left"] >= -0.5 and bounds["right"] <= width + 0.5, (identifier, bounds))
        check(bounds["scroll"] <= bounds["client"], (identifier, bounds))
        layouts[-1].setdefault("features", {})[identifier] = bounds


def matrix_values(page):
    return page.locator("#matrix-table tbody tr").evaluate_all(
        "rows => rows.map(row => Array.from(row.querySelectorAll('td'), cell => Number(cell.textContent)))"
    )



def threshold_settings(page, k, n):
    text = page.locator("#threshold-summary").inner_text()
    check(re.search(r"k\s*=\s*" + str(k) + r"\b", text), ("threshold k", k, text))
    check(re.search(r"n\s*=\s*" + str(n) + r"\b", text), ("threshold n", n, text))
    check(page.locator("#sharing-primer").is_visible(), "general sharing introduction stays visible")


def axis_metrics(page, identifiers):
    results = {}
    for identifier in identifiers:
        measured = page.locator("#" + identifier).evaluate("""svg => {
          const outer=svg.getBoundingClientRect(), scale=svg.getScreenCTM();
          return [...svg.querySelectorAll('.grid-axis-label')].map(el=>{
            const r=el.getBoundingClientRect();
            return {text:el.textContent, font:parseFloat(getComputedStyle(el).fontSize),
              renderedFont:parseFloat(getComputedStyle(el).fontSize)*Math.hypot(scale.a,scale.b),
              inside:r.left>=outer.left-.02&&r.right<=outer.right+.02&&r.top>=outer.top-.02&&r.bottom<=outer.bottom+.02};
          });
        }""")
        check(len(measured) == 2, ("two axis labels", identifier, measured))
        check(all(x["font"] >= 14 and x["renderedFont"] >= 14 and x["inside"] for x in measured),
              ("axis names are readable and unclipped", identifier, measured))
        results[identifier] = measured
    return results


def mark_geometry(page, identifier, rings=True):
    measured = page.locator("#" + identifier).evaluate("""svg => {
      const lines=[...svg.querySelectorAll('.grid-line')];
      const xs=[...new Set(lines.filter(e=>e.getAttribute('x1')===e.getAttribute('x2')).map(e=>Number(e.getAttribute('x1'))))].sort((a,b)=>a-b);
      const ys=[...new Set(lines.filter(e=>e.getAttribute('y1')===e.getAttribute('y2')).map(e=>Number(e.getAttribute('y1'))))].sort((a,b)=>b-a);
      const matrix=svg.getScreenCTM(), selected=[...svg.querySelectorAll('.grid-selected')];
      return [...svg.querySelectorAll('.grid-mark')].map(el=>{
        const [x,y]=el.dataset.point.split(',').map(Number), b=el.getBBox();
        const expected=new DOMPoint(xs[x],ys[y]).matrixTransform(matrix);
        const center=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(el.getScreenCTM());
        const ring=selected.find(e=>Math.abs(Number(e.getAttribute('cx'))-xs[x])<.001&&Math.abs(Number(e.getAttribute('cy'))-ys[y])<.001);
        return {mark:Number(el.dataset.mark),tag:el.tagName,point:[x,y],
          error:Math.hypot(center.x-expected.x,center.y-expected.y),ring:!!ring,
          signature:[el.tagName,el.getAttribute('d'),el.getAttribute('points'),el.getAttribute('r'),el.getAttribute('width')].join('|')};
      });
    }""")
    check(measured, ("geometric marks exist", identifier))
    check(all(x["tag"] != "text" and x["error"] < .02 for x in measured), ("mark centers equal lattice centers", measured))
    if rings:
        check(all(x["ring"] for x in measured), ("each mark shares its center with the outer ring", measured))
    return measured


def hover_grid(page, identifier, coordinate, expected, edge=False, axes="x\u2081,x\u2082"):
    svg = page.locator("#" + identifier)
    svg.evaluate("el => el.scrollIntoView({block:'center'})")
    position = svg.evaluate("""(svg,input) => {
      const lines=[...svg.querySelectorAll('.grid-line')];
      const xs=[...new Set(lines.filter(e=>e.getAttribute('x1')===e.getAttribute('x2')).map(e=>Number(e.getAttribute('x1'))))].sort((a,b)=>a-b);
      const ys=[...new Set(lines.filter(e=>e.getAttribute('y1')===e.getAttribute('y2')).map(e=>Number(e.getAttribute('y1'))))].sort((a,b)=>b-a);
      const [x,y]=input.coordinate,v=svg.viewBox.baseVal;
      const local=input.edge ? [x?v.width-1:1,y?v.height-1:1] : [xs[0]+x*(xs[1]-xs[0]),ys[0]+y*(ys[1]-ys[0])];
      const p=new DOMPoint(...local).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y};
    }""", {"coordinate": coordinate, "edge": edge})
    page.mouse.move(position["x"], position["y"])
    popup = svg.locator(".grid-tooltip")
    check(popup.count() == 1 and popup.get_attribute("visibility") == "visible", ("hover popup visible", identifier))
    check(popup.get_attribute("data-coordinate") == ",".join(map(str, expected)), ("nearest lattice coordinate", identifier, coordinate, expected))
    check(popup.get_attribute("data-axes") == axes, ("coordinate axes", identifier))
    check("(" + ", ".join(map(str, expected)) + ")" in popup.text_content(), "coordinate text matches state")
    bounds = popup.evaluate("""el=>{
      const svg=el.ownerSVGElement,v=svg.viewBox.baseVal,box=el.querySelector('rect').getBBox();
      const labels=[...el.querySelectorAll('text')].map(t=>t.getBBox());
      return {x:box.x,y:box.y,width:box.width,height:box.height,
        inside:box.x>=0&&box.y>=0&&box.x+box.width<=v.width&&box.y+box.height<=v.height,
        textInside:labels.every(b=>b.x>=box.x&&b.y>=box.y&&b.x+b.width<=box.x+box.width+.02&&b.y+b.height<=box.y+box.height+.02)};
    }""")
    check(bounds["inside"] and bounds["textInside"], ("popup rectangle and text fit SVG", identifier, bounds))
    check(page.evaluate("() => window.__qaGridPointer.trusted && window.__qaGridPointer.type === 'mouse'"), "real mouse pointer reaches graph")
    return {"graph": identifier, "input": coordinate, "expected": expected, "edge": edge, "box": bounds}


def math_primer_closed(page):
    primer = page.locator("#math-primer")
    check(primer.get_attribute("open") is None, "math prerequisite starts collapsed")
    check(not page.locator("#real-story").is_visible(), "closed prerequisite hides its three graphs")
    order = primer.evaluate("""el => el.previousElementSibling.tagName === 'H2' &&
      el.nextElementSibling.id === 'sharing-primer' && el.contains(document.querySelector('#real-story'))""")
    check(order, "math prerequisite immediately follows h2 and precedes sharing definitions")
    check(page.locator("#guides").evaluate("""el => !el.closest('#math-primer') &&
      !!(el.compareDocumentPosition(document.querySelector('#main-grid')) & Node.DOCUMENT_POSITION_FOLLOWING)"""),
          "main experiment guide control precedes its graph outside prerequisite")


def math_approach_geometry(page, default, expected_approach=None):
    """Check drawn SVG coordinates against independent arithmetic from the vector."""
    radios = page.locator('input[name="math-approach"]')
    check(radios.count() == 2, "two native math approach radios")
    check(radios.evaluate_all("els => els.every(el => el.type === 'radio' && el.closest('fieldset')?.querySelector('legend'))"),
          "math approaches form a labelled native fieldset")
    approach = page.locator('input[name="math-approach"]:checked').input_value()
    check(approach in ("folded", "x-order"), "valid selected math approach")
    if expected_approach is not None:
        check(approach == expected_approach, "math approach selection survives experimental changes")
    graph = page.locator("#mod-grid")
    check(graph.get_attribute("data-approach") == approach, "rendered approach matches checked radio")
    enabled = page.locator("#math-guides").is_checked()
    check(graph.get_attribute("data-guides") == str(enabled).lower(), "rendered math guide state agrees")
    p, (a, b), rhs = default["p"], default["A"][0], default["c"][0]
    points = default["lines"][0]
    check(sorted_points(point_data(page, "mod-grid")) == sorted_points(points), "both approaches keep all authoritative points")
    marks = mark_geometry(page, "mod-grid", rings=False)
    check(sorted_points([mark["point"] for mark in marks]) == sorted_points(points), "all thirteen rendered marks match authoritative points")
    geometry = graph.evaluate("""svg => {
      const lines=[...svg.querySelectorAll('.grid-line')];
      const xs=[...new Set(lines.filter(e=>e.getAttribute('x1')===e.getAttribute('x2')).map(e=>Number(e.getAttribute('x1'))))].sort((a,b)=>a-b);
      const ys=[...new Set(lines.filter(e=>e.getAttribute('y1')===e.getAttribute('y2')).map(e=>Number(e.getAttribute('y1'))))].sort((a,b)=>b-a);
      const guides=[...svg.querySelectorAll('.graph-guide')], marks=[...svg.querySelectorAll('.grid-mark')], step=svg.querySelector('.rule-step');
      return {xs,ys,paths:guides.map(e=>e.getAttribute('d')),
        behind:guides.every(g=>marks.every(m=>!!(g.compareDocumentPosition(m)&Node.DOCUMENT_POSITION_FOLLOWING))),
        arrow:step?{from:JSON.parse(step.dataset.from),to:JSON.parse(step.dataset.to),delta:JSON.parse(step.dataset.delta),
          lines:[...step.querySelectorAll('line.rule-arrow')].map(e=>['x1','y1','x2','y2'].map(k=>Number(e.getAttribute(k)))),
          polygon:step.querySelector('polygon.rule-arrow')?.getAttribute('points')}:null};
    }""")
    check(len(geometry["paths"]) == int(enabled), "one guide path when enabled, none when disabled")
    check(geometry["behind"], "math guides are drawn behind their points")
    xs, ys = geometry["xs"], geometry["ys"]
    def lattice(x, y):
        return ((x - xs[0]) / (xs[1] - xs[0]), (y - ys[0]) / (ys[1] - ys[0]))
    def canonical(segments):
        return sorted(tuple(sorted(tuple(round(value, 6) for value in point) for point in segment)) for segment in segments)
    segments = []
    command = r"([ML])\s*([-+\d.eE]+)[ ,]+([-+\d.eE]+)"
    for d in geometry["paths"]:
        check(not re.sub(command, "", d).strip(), ("unparsed SVG path", d))
        previous = None
        for operation, x, y in re.findall(command, d):
            point = lattice(float(x), float(y))
            if operation == "L":
                check(previous is not None, "line follows a move")
                segments.append([previous, point])
            previous = point
    levels = sorted({a * x + b * y for x, y in points})
    expected_segments = []
    if approach == "folded":
        for level in levels:
            candidates = [(x, (level - a * x) / b) for x in (0, p - 1)]
            candidates += [((level - b * y) / a, y) for y in (0, p - 1)]
            ends = sorted(set(point for point in candidates if all(0 <= value <= p - 1 for value in point)))
            check(len(ends) == 2, "each folded level has two box intersections")
            expected_segments.append(ends)
    else:
        inverse = next(value for value in range(1, p) if b * value % p == 1)
        rise = -a * inverse % p
        expected_segments = [[first, second] for first, second in zip(points, points[1:]) if second[1] - first[1] == rise]
    check(canonical(segments) == canonical(expected_segments if enabled else []),
          ("drawn math path matches independent clipped lines or x-order steps", approach, segments, expected_segments))
    integer_points = [point for point in points if point[0] in default["integerCandidates"][0]]
    source_points = integer_points if approach == "folded" else points
    start, finish = source_points[:2]
    delta = [finish[i] - start[i] for i in (0, 1)]
    arrow = geometry["arrow"]
    check(arrow is not None and arrow["from"] == start and arrow["to"] == finish and arrow["delta"] == delta,
          "step arrow uses the selected mathematical direction")
    check(len(arrow["lines"]) == 2, "step arrow has horizontal and vertical legs")
    horizontal, vertical = arrow["lines"]
    check(horizontal[2] > horizontal[0] and abs(horizontal[3] - horizontal[1]) < .001, "step arrow points right")
    check(abs(vertical[2] - vertical[0]) < .001 and (vertical[3] - vertical[1]) * delta[1] < 0,
          "step arrow vertical direction agrees with selected approach")
    polygon = [float(value) for value in re.findall(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", arrow["polygon"])]
    check(len(polygon) == 6, "triangle arrowhead")
    distance = min(((polygon[i] - xs[finish[0]]) ** 2 + (polygon[i + 1] - ys[finish[1]]) ** 2) ** .5 for i in (0, 2, 4))
    check(distance >= 5.9, "arrowhead does not cover destination point")
    def pairs(identifier):
        text = page.locator("#" + identifier).inner_text().replace("\u2212", "-")
        return [[int(x), int(y)] for x, y in re.findall(r"\((-?\d+),\s*(-?\d+)\)", text)]
    example = pairs("mod-example")
    if approach == "folded":
        inputs = [[14, 5], [32, -1]]
        expected_example = [point for original in inputs for point in (original, [value % p for value in original])]
        check(all(a * x + b * y == default["cInt"][0] for x, y in inputs), "fold examples lie on original real line")
        check(example == expected_example, "both coordinate axes reduce modulo the fixed field")
        check(pairs("mod-rule") == integer_points[:2], "folded rule gives the same right/down step as the arrow")
    else:
        check(example == points[:4], "x-order example wraps the fourth point correctly")
    check(bool(page.locator("#mod-note").inner_text().strip()), "common finite-field guide note is present")
    return {"approach": approach, "guides": enabled, "segments": segments, "rhs_levels": levels,
            "step": arrow, "example": example, "arrow_clearance": distance}


def fixed_math_example(page, default):
    check(page.locator("#math-primer").get_attribute("open") is not None, "fixed prerequisite is open")
    check(page.locator("#real-story").is_visible(), "fixed prerequisite stays visible for every experiment")
    page.wait_for_function("""p => ['real-grid','integer-grid','mod-grid'].every(id => {
      const el=document.getElementById(id), box=el.getBoundingClientRect();
      return el.querySelectorAll('.grid-line').length === p * 2 && Math.abs(el.viewBox.baseVal.width-box.width)<1;
    })""", arg=default["p"])
    expected = default["lines"][0]
    integers_expected = [point for point in expected if point[0] in default["integerCandidates"][0]]
    check(page.locator("#real-grid").get_attribute("data-rhs") == str(default["cInt"][0]),
          "real prerequisite retains the default integer RHS independently of experiment")
    check(sorted_points(point_data(page, "integer-grid")) == sorted_points(integers_expected),
          "integer prerequisite retains the four authoritative points")
    check(sorted_points(point_data(page, "mod-grid")) == sorted_points(expected),
          "mod prerequisite retains all thirteen authoritative points")
    check(str(default["cInt"][0]) in page.locator("#integer-explanation").inner_text(), "fixed integer explanation RHS")
    axes = axis_metrics(page, ("real-grid", "integer-grid", "mod-grid"))
    check(all([axis["text"] for axis in measured] == ["x\u2082", "x\u2081"] for measured in axes.values()),
          "mathematical prerequisite axes use coordinate names without introducing secret or randomness")
    return {"rhs": int(page.locator("#real-grid").get_attribute("data-rhs")),
            "integer_points": point_data(page, "integer-grid"), "mod_points": point_data(page, "mod-grid"), "axes": axes,
            "approach": math_approach_geometry(page, default)}


def fixed_math_after_change(page, default):
    check(page.locator("#math-x-order").is_checked(), "experimental changes preserve selected x-order approach")
    original = fixed_math_example(page, default)
    check(page.locator("#math-guides").is_checked(), "experimental changes preserve enabled math guides")
    page.locator("#math-folded").check()
    folded = fixed_math_example(page, default)
    page.locator("#math-x-order").check()
    fixed_math_example(page, default)
    return {"x-order": original, "folded": folded}


def test_math_primer(page, width, layouts, default):
    math_primer_closed(page)
    summary = page.locator("#math-primer > summary")
    summary.focus()
    page.keyboard.press("Enter")
    opened = fixed_math_example(page, default)
    placement = page.evaluate("""() => {
      const owns=(id,graph)=>document.getElementById(id).closest('figure')?.contains(document.getElementById(graph));
      return owns('integer-explanation','integer-grid') && ['math-guides','math-folded','math-x-order','mod-rule','mod-example','mod-note']
        .every(id=>owns(id,'mod-grid'));
    }""")
    check(placement, "integer explanation belongs to step two; approach controls and explanations belong to step three")
    check(page.locator("#math-folded").is_checked(), "folded approach is the default")
    check(page.locator("#math-guides").is_checked(), "math guides are initially enabled")
    check(not page.locator("#guides").is_checked(), "experiment guides retain their independent disabled default")
    check(summary.evaluate("el => document.activeElement === el"), "Enter opening preserves summary focus")
    page.keyboard.press("Space")
    check(page.locator("#math-primer").get_attribute("open") is None, "Space closes math prerequisite")
    check(summary.evaluate("el => document.activeElement === el"), "Space closing preserves summary focus")
    alternate_width = 390 if width == 320 else 320
    page.set_viewport_size({"width": alternate_width, "height": 900})
    check(page.locator("#math-primer").get_attribute("open") is None, "resize leaves prerequisite closed")
    page.keyboard.press("Enter")
    resized = fixed_math_example(page, default)
    feature_layout(page, alternate_width, "math-closed-resize-open", layouts, ("real-grid", "integer-grid", "mod-grid"))
    page.set_viewport_size({"width": width, "height": 900})
    restored = fixed_math_example(page, default)
    feature_layout(page, width, "math-open-resize", layouts, ("real-grid", "integer-grid", "mod-grid"))
    note = page.locator("#mod-note").inner_text()
    for key, identifier in (("ArrowRight", "math-x-order"), ("ArrowLeft", "math-folded")):
        current = page.locator('input[name="math-approach"]:checked')
        current.focus()
        page.keyboard.press(key)
        check(page.locator("#" + identifier).is_checked(), "native arrow key selects math approach")
        check(page.locator("#" + identifier).evaluate("el => document.activeElement === el"), "approach switch retains radio focus")
        fixed_math_example(page, default)
    page.locator("#math-x-order").focus()
    page.keyboard.press("Space")
    check(page.locator("#math-x-order").is_checked(), "Space activates a focused approach radio")
    check(page.locator("#math-x-order").evaluate("el => document.activeElement === el"), "Space preserves approach radio focus")
    toggles = []
    language = page.locator("html").get_attribute("lang")
    theme = page.locator("html").get_attribute("data-theme")
    for approach in ("folded", "x-order"):
        page.locator("#math-" + approach).check()
        check(page.locator("#mod-note").inner_text() == note, "common field note remains unchanged by approach")
        for math_on, main_on in ((False, False), (True, False), (True, True), (False, True), (False, False)):
            page.locator("#math-guides").set_checked(math_on)
            page.locator("#guides").set_checked(main_on)
            check(page.locator("#math-guides").is_checked() == math_on and page.locator("#guides").is_checked() == main_on,
                  "math and main checkbox states are independent")
            check(page.locator("#mod-grid .graph-guide").count() == int(math_on), "math guide only changes fixed mod graph")
            check(page.locator("#main-grid .graph-guide").count() == int(main_on), "main guide only changes selected experiment")
            measured = fixed_math_example(page, default)
            check(sorted_points(point_data(page, "main-grid")) == sorted_points(default["lines"][0]),
                  "independent guides preserve experiment points")
            toggles.append({"math": math_on, "main": main_on, "geometry": measured["approach"]})
        page.locator("#math-guides").check()
        for control in ("theme", "language", "language", "theme"):
            page.locator("#" + control).click()
            check(page.locator("#math-" + approach).is_checked(), "preference redraw preserves selected math approach")
            fixed_math_example(page, default)
        assert_preference(page, language, theme)
        feature_layout(page, width, "math-approach-" + approach, layouts, ("real-grid", "integer-grid", "mod-grid"))
        page.set_viewport_size({"width": alternate_width, "height": 900})
        fixed_math_example(page, default)
        check(page.locator("#math-" + approach).is_checked(), "resize preserves selected math approach")
        feature_layout(page, alternate_width, "math-approach-resize-" + approach, layouts, ("real-grid", "integer-grid", "mod-grid"))
        page.set_viewport_size({"width": width, "height": 900})
        fixed_math_example(page, default)
        check(page.locator("#math-" + approach).is_checked(), "resizing back preserves selected math approach")
    return {"initial_open": opened, "closed_resize_open": resized, "open_resize": restored, "guide_states": toggles}



def test_coordinate_ui(page, width, layouts, language):
    vectors = json.loads((ROOT / "test/vectors.json").read_text(encoding="utf-8"))
    default = vectors["default_k2"]
    math_evidence = test_math_primer(page, width, layouts, default)
    threshold_settings(page, 2, 4)
    order = page.evaluate("""() => {
      const intro=document.querySelector('#intro-grid').getBoundingClientRect();
      return ['sharing-primer','initial-example-primer'].every(id=>document.getElementById(id).getBoundingClientRect().bottom<=intro.top);
    }""")
    check(order, "definitions and distributed equations appear before the first graph")
    rows = page.locator(".primer-equations tbody tr").evaluate_all("els=>els.map(el=>[...el.cells].map(c=>c.textContent.trim()))")
    expected = []
    for index, (coefficients, rhs) in enumerate(zip(default["A"], default["c"])):
        terms = [("" if a == 1 else str(a)) + "x" + "\u2081\u2082"[j] for j, a in enumerate(coefficients)]
        expected.append(["#" + str(index + 1), "+".join(terms) + "\u2261" + str(rhs) + "(mod13)"])
    check([[r[0], re.sub(r"\s", "", r[1])] for r in rows] == expected, "four initial equations match authoritative vector")
    explanation = page.locator('[data-i18n="primerEquationDefinition"]').inner_text()
    compact = re.sub(r"\s", "", explanation)
    check("a,b" in compact and "c" in compact and "modp" in compact, "distributed equation explains its coefficients and modulus")
    check(("1\u672c\u306e\u5f0f" if language == "ja" else "one equation") in explanation,
          "giving coefficients and RHS is explained as giving one equation")
    graphs = ("intro-grid", "real-grid", "integer-grid", "mod-grid", "main-grid")
    axes = axis_metrics(page, graphs)
    check(page.locator("#panel-intersections svg.coordinate-plane[tabindex]").count() == 0, "coordinate plots add no tab stops")
    page.evaluate("""() => document.addEventListener('pointermove',e=>{
      window.__qaGridPointer={type:e.pointerType,trusted:e.isTrusted};
    },true)""")
    hover = []
    for identifier in graphs:
        hover.append(hover_grid(page, identifier, [5, 8], [5, 8]))
    for point, nearest in (([3.25, 4.25], [3, 4]), ([3.75, 4.75], [4, 5])):
        hover.append(hover_grid(page, "main-grid", point, nearest))
    for corner, nearest in (([0, 0], [0, 12]), ([1, 0], [12, 12]), ([0, 1], [0, 0]), ([1, 1], [12, 0])):
        hover.append(hover_grid(page, "main-grid", corner, nearest, edge=True))
    active = page.evaluate("() => document.activeElement.id")
    page.keyboard.press("Escape")
    check(page.locator("#main-grid .grid-tooltip").get_attribute("visibility") == "hidden", "Escape hides coordinates")
    check(page.evaluate("() => document.activeElement.id") == active, "Escape does not move focus")
    hover_grid(page, "main-grid", [5, 8], [5, 8])
    page.mouse.move(1, 1)
    check(page.locator("#main-grid .grid-tooltip").get_attribute("visibility") == "hidden", "leaving graph hides coordinates")
    click_visible(page, "candidate-all")
    original = mark_geometry(page, "main-grid")
    show_details(page, "dealer")
    page.locator("#share-count").select_option("8")
    page.wait_for_function("() => !document.querySelector('#generate').disabled")
    threshold_settings(page, 2, 8)
    math_evidence["n8"] = fixed_math_after_change(page, default)
    click_visible(page, "candidate-all")
    shapes = []
    for index in range(8):
        choose_shares(page, {index})
        measured = mark_geometry(page, "main-grid")
        check({m["mark"] for m in measured} == {index}, ("selected share uses its geometric mark", index))
        shapes.append(measured[0])
    check(len({m["signature"] for m in shapes}) == 8, "all eight share marks are geometrically distinct")
    choose_shares(page, {0})
    page.locator("#prime").select_option("7")
    page.wait_for_function("() => !document.querySelector('#generate').disabled")
    page.locator("#generate").click()
    page.wait_for_function("() => !document.querySelector('#generate').disabled")
    threshold_settings(page, 2, 6)
    distribution = table_rows(page, "distribution-table")[0]
    coefficients = integers(distribution[1])
    rhs = int(re.search(r"\u2261\s*(\d+)", distribution[2]).group(1))
    check(sorted_points(point_data(page, "main-grid")) == sorted_points(field_points([coefficients], [rhs], 7)), "regenerated graph agrees with distributed equation")
    hover.append(hover_grid(page, "main-grid", [1, 0], [6, 6], edge=True))
    actual = point_data(page, "main-grid")[0]
    hover.append(hover_grid(page, "main-grid", actual, actual))
    math_evidence["p7-generated"] = fixed_math_after_change(page, default)
    math_evidence["all_primes"] = {}
    for prime in page.locator("#prime option").evaluate_all("els => els.map(el => el.value)"):
        page.locator("#prime").select_option(prime)
        page.wait_for_function("() => !document.querySelector('#generate').disabled")
        math_evidence["all_primes"][prime] = fixed_math_after_change(page, default)
    click_visible(page, "k3-start")
    threshold_settings(page, 3, len(vectors["default_k3"]["A"]))
    math_evidence["k3"] = fixed_math_after_change(page, default)
    axes.update(axis_metrics(page, ("slice-grid",)))
    hover.append(hover_grid(page, "slice-grid", [2, 9], [2, 9], axes="x\u2082,x\u2083"))
    for dimension in (4, 5):
        click_visible(page, "k" + str(dimension))
        threshold_settings(page, dimension, len(vectors["default_k" + str(dimension)]["A"]))
        math_evidence["k" + str(dimension)] = fixed_math_after_change(page, default)
    click_visible(page, "k2-start")
    for identifier in ("advanced", "dealer"):
        if page.locator("#" + identifier).get_attribute("open") is not None:
            page.locator("#" + identifier + " > summary").click()
    threshold_settings(page, 2, 4)
    feature_layout(page, width, "coordinate-ui-verified", layouts, graphs + ("sharing-primer", "initial-example-primer"))
    page.locator("#math-primer > summary").click()
    math_primer_closed(page)
    return {"axis_labels": axes, "hover": hover, "eight_shapes": shapes, "math_primer": math_evidence,
            "initial_mark_center_error": max(x["error"] for x in original)}


def test_grid_touch(page, cdp, width, evidence):
    click_visible(page, "k2-start")
    graph = page.locator("#main-grid")
    graph.evaluate("el => el.scrollIntoView({block:'center'})")
    box = graph.bounding_box()
    x, y = box["x"] + box["width"] * .5, box["y"] + box["height"] * .8
    check(0 < x < width and 0 < y < 900, "grid touch starts within viewport")
    before = page.evaluate("() => scrollY")
    page.evaluate("() => { window.__qaTouch = []; }")
    point = {"x": x, "y": y, "id": 9, "radiusX": 3, "radiusY": 3, "force": 1}
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [point]})
    for step in range(1, 9):
        point = {**point, "y": y - box["height"] * .6 * step / 8}
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [point]})
        page.wait_for_timeout(20)
        check(graph.locator(".grid-tooltip").get_attribute("visibility") == "hidden", "touch does not open hover popup")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(80)
    after = page.evaluate("() => scrollY")
    events = page.evaluate("() => window.__qaTouch")
    names = [event["name"] for event in events if event["type"] == "touch" and event["trusted"]]
    check("pointerdown" in names and "pointermove" in names and "pointercancel" in names, "native grid touch reaches pointer handlers")
    check(after > before + 30, "coordinate popup preserves native vertical touch scrolling")
    evidence["grid-vertical"] = {"box": box, "before": before, "after": after, "events": events}


def camera_angles(page):
    text = page.locator("#camera-description").inner_text()
    import re
    return [float(number) for number in re.findall(r"-?\d+(?:\.\d+)?(?=°)", text)]


def check_slices(page, expected):
    check(page.locator("#slices button").count() == len(expected), "slice count")
    for index, points in enumerate(expected):
        check(sorted_points(point_data(page, "slice-" + str(index))) == sorted_points(points),
              ("slice", index, points))


def test_k2(page, width, layouts, vectors, language):
    default = vectors["default_k2"]
    math_primer_closed(page)
    show_details(page, "math-primer")
    fixed_math_after_change(page, default)
    expected = default["lines"][0]
    check(sorted_points(point_data(page, "intro-grid")) == sorted_points(expected), "intro vector points")
    check(sorted_points(point_data(page, "main-grid")) == sorted_points(expected), "selected line points")
    check(selected_shares(page) == 1, "one initially selected share")
    check(page.locator("#dealer").get_attribute("open") is None, "dealer initially collapsed")
    integer_points = [point for point in expected if point[0] in default["integerCandidates"][0]]
    check(sorted_points(point_data(page, "integer-grid")) == sorted_points(integer_points), "integer grid vector points")
    check(sorted_points(point_data(page, "mod-grid")) == sorted_points(expected), "mod grid vector points")
    check(str(default["cInt"][0]) in page.locator("#integer-explanation").inner_text(), "integer RHS")
    check(page.locator("#real-grid").get_attribute("data-rhs") == str(default["cInt"][0]), "real line uses integer RHS")
    feature_layout(page, width, "k2-initial", layouts,
                   ("intro-grid", "main-grid", "real-grid", "integer-grid", "mod-grid"))
    readable_copy(page, "#selection-explanation")
    current_example = readable_copy(page, "#intro-current-example")
    check(str(default["p"]) in current_example and "#1" in current_example, "current example identifies field and share")
    initial_candidate = page.locator("#candidate-value").inner_text()
    initial_explanation = readable_copy(page, "#candidate-explanation")
    actual_secret = page.locator("#secret").input_value()
    distributed = page.locator("#distribution-table").text_content()
    all_points = point_data(page, "main-grid")
    click_visible(page, "candidate-next")
    check(page.locator("#candidate-value").inner_text() != initial_candidate, "candidate advances")
    check(readable_copy(page, "#candidate-explanation") != initial_explanation, "candidate explanation follows the tested value")
    check(page.locator("#secret").input_value() == actual_secret, "trying a candidate does not change the real secret")
    check(page.locator("#distribution-table").text_content() == distributed, "trying a candidate preserves distributed shares")
    check(point_data(page, "main-grid") == all_points, "trying a candidate preserves all possible points")
    check("9" in page.locator("#candidate-equation").inner_text(), "inverse shown in remaining equation")
    click_visible(page, "candidate-prev")
    check(page.locator("#candidate-value").inner_text() == initial_candidate, "candidate returns")
    click_visible(page, "candidate-all")
    check(page.locator("#candidate-all").get_attribute("aria-pressed") == "true", "all candidates enabled")
    feature_layout(page, width, "k2-all-candidates", layouts, ("main-grid",))
    click_visible(page, "candidate-all")
    choose_shares(page, {0, 1})
    check(",".join(map(str, default["X"])) in page.locator("#recovery-result").inner_text().replace(" ", ""), "two-share recovery")
    choose_shares(page, {0, 1, 2})
    check(",".join(map(str, default["X"])) in page.locator("#combination-results").inner_text().replace(" ", ""), "third share agrees")
    choose_shares(page, {0, 1, 2, 3})
    check(page.locator("#combination-results tbody tr").count() == 6, "all six pairs")
    feature_layout(page, width, "k2-four-shares", layouts, ("main-grid",))
    choose_shares(page, {0, 1})
    show_details(page, "edit-controls")
    original_value = page.locator("#recovery-result").inner_text()
    click_visible(page, "shift-plus")
    altered_rhs = [(default["c"][0] + 1) % default["p"], default["c"][1]]
    altered = field_points(default["A"][:2], altered_rhs, default["p"])[0]
    check(visible_coordinate_pairs(page.locator("#recovery-result").inner_text()) == [altered],
          "two edited shares return the independently calculated altered point")
    check(page.locator("#recovery-result").get_attribute("data-source") == "edited", "altered recovery identifies its source")
    edited_explanation = readable_copy(page, "#selection-explanation")
    check(page.locator("#secret").input_value() == actual_secret and
          page.locator("#distribution-table").text_content() == distributed, "copy editing preserves dealer's original answer")
    choose_shares(page, {0, 1, 2, 3})
    check(not field_points(default["A"], [altered_rhs[0], *default["c"][1:]], default["p"]), "edited four-share system is inconsistent")
    check(readable_copy(page, "#selection-explanation") != edited_explanation, "inconsistent-copy explanation differs from altered unique recovery")
    click_visible(page, "reset-edit")
    choose_shares(page, {0, 1})
    check(page.locator("#recovery-result").get_attribute("data-source") == "distributed", "reset returns to distributed source")
    check(page.locator("#recovery-result").inner_text() == original_value, "reset restores original answer text")
    choose_shares(page, set())
    empty_explanation = readable_copy(page, "#selection-explanation")
    check(str(default["p"] ** 2) in empty_explanation, "zero-share explanation accounts for the full grid")
    check(not page.locator("#candidate-explanation").is_visible(), "zero shares do not present a tested single candidate")
    check(not selected_shares(page), "zero selected shares allowed")
    check(not point_data(page, "main-grid"), "no selected line points")
    choose_shares(page, {0})
    show_details(page, "dealer")
    original_distribution = page.locator("#distribution-table").inner_text()
    show_details(page, "edit-controls")
    before_shift = point_data(page, "main-grid")
    click_visible(page, "shift-plus")
    check(point_data(page, "main-grid") != before_shift, "shift changes drawn copy")
    fixed_math_after_change(page, default)
    click_visible(page, "shift-minus")
    check(point_data(page, "main-grid") == before_shift, "opposite shift restores copy")
    check(page.locator("#distribution-table").inner_text() == original_distribution, "editing preserves distributed values")
    fixed_math_after_change(page, default)
    check(page.locator("#edited-real-note").is_visible(), "edited real explanation")
    click_visible(page, "reset-edit")
    fixed_math_after_change(page, default)
    for _ in range(default["A"][0][1]):
        click_visible(page, "direction-minus")
    warning = page.locator("#edit-warning").inner_text()
    expected_warning = "この1本で s が決まる" if language == "ja" else "This one share determines s"
    check(expected_warning in warning, "vertical line warning")
    fixed_math_after_change(page, default)
    show_details(page, "advanced")
    inspection = page.locator("#inspection-list")
    open_ancestors(inspection)
    check("✗" in inspection.inner_text(), "vertical line fails inspection")
    feature_layout(page, width, "k2-invalid-vertical", layouts, ("main-grid",))
    click_visible(page, "reset-edit")
    import re
    for _ in range(default["p"]):
        click_visible(page, "direction-plus")
        warning = page.locator("#edit-warning").inner_text()
        if re.search(r"#(\d+)", warning):
            break
    match = re.search(r"#(\d+)", warning)
    check(match is not None, "parallel warning identifies other share")
    other_points = sorted_points(default["lines"][int(match.group(1)) - 1])
    current_points = sorted_points(point_data(page, "main-grid"))
    check(not set(current_points).intersection(other_points), "parallel warning corresponds to disjoint lines")
    check(("交点はありません" if language == "ja" else "no intersection") in warning, "disjoint warning")
    for _ in range(default["p"]):
        click_visible(page, "shift-plus")
        if sorted_points(point_data(page, "main-grid")) == other_points:
            break
    check(sorted_points(point_data(page, "main-grid")) == other_points, "shift reaches same reference line")
    check(("同じ直線" if language == "ja" else "same line") in page.locator("#edit-warning").inner_text(), "coincident warning")
    check(int(page.locator("#inspection-list").get_attribute("data-failed")) > 0, "parallel line fails inspection")
    click_visible(page, "reset-edit")
    previous = point_data(page, "main-grid")
    page.locator("#edit-actions").focus()
    page.keyboard.press("ArrowUp")
    check(point_data(page, "main-grid") != previous, "keyboard shifts selected copy")
    click_visible(page, "reset-edit")
    page.locator("#dealer > summary").click()
    page.locator("#edit-controls > summary").click()


def test_k3(page, width, layouts, vectors):
    default = vectors["default_k3"]
    previous_heading = page.locator("#explore-title").inner_text()
    click_visible(page, "k3-start")
    heading = readable_copy(page, "#explore-title")
    check(heading != previous_heading and re.search(r"(?<!\d)3(?!\d)|\bthree\b", heading, re.IGNORECASE),
          "three-share threshold has its own exploration heading")
    readable_copy(page, "#dimension-intro")
    readable_copy(page, "#slice-explanation")
    check(not page.locator("#slice-recovered").is_visible(), "two planes have no single recovered slice shortcut")
    check(page.locator("#prime").input_value() == str(default["p"]), "k3 default prime")
    check(selected_shares(page) == 2, "k3 starts with two shares")
    check("X" not in page.locator("#scene-table tbody tr td:first-child").all_text_contents(), "two planes do not reveal X in table")
    check_slices(page, default["slices12"])
    check(page.locator("#slice-grid .grid-secret").count() == 0, "two planes do not mark a known secret")
    common = page.locator("#slice-grid .grid-overlap[data-point]").get_attribute("data-point")
    check(common == ",".join(map(str, default["slices12"][0][0])), "two-plane common point")
    click_visible(page, "candidate-all")
    check(page.locator("#slices .slice-candidate-ring").count() == default["p"], "all slice candidates highlighted")
    click_visible(page, "candidate-all")
    check(page.locator("#slices .slice-candidate-ring").count() == 1, "one slice candidate highlighted")
    check(camera_angles(page) == [35, 25], "initial camera")
    feature_layout(page, width, "k3-two-planes", layouts, ("scene", "slices", "slice-grid"))
    click_visible(page, "slice-7")
    check(page.locator("#slice-7").get_attribute("aria-pressed") == "true", "slice selected")
    check("(2,9)" in page.locator("#slice-result").inner_text().replace(" ", ""), "selected slice vector")
    check(page.locator("#scene [data-slice='7']").count() > 0, "real board uses selected slice")
    click_visible(page, "yaw-right")
    check(camera_angles(page) == [45, 25], "yaw button increment")
    page.locator("#scene").focus()
    page.keyboard.press("ArrowLeft")
    check(camera_angles(page) == [35, 25], "yaw keyboard increment")
    for _ in range(12):
        click_visible(page, "pitch-up")
    check(camera_angles(page)[1] == 80, "pitch upper bound")
    for _ in range(20):
        click_visible(page, "pitch-down")
    check(camera_angles(page)[1] == -80, "pitch lower bound")
    click_visible(page, "camera-reset")
    check(camera_angles(page) == [35, 25], "camera reset")
    check(page.locator("#scene").evaluate("el => getComputedStyle(el).touchAction") == "pan-y", "vertical scrolling allowed")
    scene = page.locator("#scene")
    scene.scroll_into_view_if_needed()
    box = scene.bounding_box()
    page.mouse.move(box["x"] + box["width"] * .3, box["y"] + box["height"] * .5)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * .7, box["y"] + box["height"] * .5, steps=4)
    page.mouse.up()
    moved = camera_angles(page)
    check(moved[0] != 35 and moved[1] == 25, "horizontal drag changes only yaw")
    click_visible(page, "camera-reset")
    toggles = page.locator("#plane-toggles input[type='checkbox']")
    check(toggles.count() >= 2, "plane display toggles")
    first = toggles.first
    plane_count = page.locator("#scene .three-plane").count()
    first.uncheck()
    check(page.locator("#scene .three-plane").count() == plane_count - 1, "plane can be hidden")
    first.check()
    choose_shares(page, {0, 1, 2})
    check_slices(page, default["slices123"])
    check(page.locator("#slice-grid .grid-secret").count() > 0, "unique system marks the secret")
    check("X" in page.locator("#scene-table tbody tr td:first-child").all_text_contents(), "three planes reveal X in table")
    click_visible(page, "slice-0")
    recovered_secret = default["X"][0]
    note = readable_copy(page, "#slice-focus-note")
    check(0 in integers(note) and recovered_secret in integers(note), "empty selected slice distinguishes tried and recovered secrets")
    check(page.locator("#slice-recovered").get_attribute("data-s") == str(recovered_secret), "shortcut targets actual recovered slice")
    check(recovered_secret in integers(readable_copy(page, "#slice-recovered")), "shortcut names the recovered secret")
    check(page.locator("#slice-grid .grid-overlap").count() == 0, "empty slice has no partial-overlap emphasis")
    check(page.locator("#slice-grid .grid-secret").count() == 0, "empty slice has no secret mark")
    page.locator("#slice-recovered").focus()
    page.keyboard.press("Enter")
    check(page.locator("#slice-" + str(recovered_secret)).evaluate("el=>el===document.activeElement"),
          "recovered-slice shortcut moves keyboard focus to the shown slice")
    check(page.locator("#slice-" + str(recovered_secret)).get_attribute("aria-pressed") == "true", "recovered slice is selected")
    check(not page.locator("#slice-recovered").is_visible() and not page.locator("#slice-focus-note").is_visible(),
          "already selected recovered slice needs no mismatch notice")
    check(point_data(page, "slice-" + str(recovered_secret)) == [default["X"][1:]], "shortcut reveals the reference point")
    feature_layout(page, width, "k3-three-planes", layouts, ("scene", "slices", "slice-grid"))
    click_visible(page, "slice-7")
    check("(2,9)" in page.locator("#slice-result").inner_text().replace(" ", ""), "three-plane slice intersection")


def test_matrices(page, width, layouts, vectors):
    for dimension in (4, 5):
        default = vectors["default_k" + str(dimension)]
        click_visible(page, "k" + str(dimension))
        choose_shares(page, set(range(dimension)))
        check(page.locator("#matrix-view").is_visible(), "matrix view")
        check(str(dimension) in readable_copy(page, "#explore-title"), "matrix exploration heading follows threshold")
        readable_copy(page, "#dimension-intro")
        initial_matrix_explanation = readable_copy(page, "#matrix-explanation")
        check(page.locator("#matrix-intro").get_attribute("data-used") == str(dimension), "matrix identifies its used equations")
        check(not page.locator("#view-3d").is_visible(), "no 3D for larger k")
        check(not page.locator("#k2-view").is_visible(), "no k2 figure for larger k")
        for index, step in enumerate(default["steps123"]):
            check(matrix_values(page) == step["m"], ("matrix", dimension, index, matrix_values(page)))
            matrix_reading(page, step["m"][0], default["p"])
            if index != len(default["steps123"]) - 1:
                click_visible(page, "matrix-next")
        check(page.locator("#matrix-next").is_disabled(), "final matrix next disabled")
        final_matrix_explanation = readable_copy(page, "#matrix-explanation")
        check(final_matrix_explanation != initial_matrix_explanation, "matrix explanation changes from progress to completed solution")
        check(",".join(map(str, default["X"])) in final_matrix_explanation.replace(" ", ""), "completed matrix explains the reference coordinates")
        click_visible(page, "matrix-prev")
        check(matrix_values(page) == default["steps123"][-2]["m"], "previous matrix")
        feature_layout(page, width, "k" + str(dimension) + "-matrix", layouts, ("matrix-table",))
        if len(default["A"]) > dimension:
            choose_shares(page, set(range(len(default["A"]))))
            scope = readable_copy(page, "#matrix-intro")
            check(page.locator("#matrix-intro").get_attribute("data-used") == str(dimension) and
                  page.locator("#matrix-intro").get_attribute("data-selected") == str(len(default["A"])),
                  "extra shares distinguish selected equations from the first k used for row operations")
            check(dimension in integers(scope) and len(default["A"]) in integers(scope), "matrix scope counts are visible")
            step_index = integers(page.locator("#matrix-step").inner_text())[0] - 1
            check(matrix_values(page) == default["steps123"][step_index]["m"], "extra shares leave row operations on the same first k equations")
        choose_shares(page, set(range(dimension - 1)))
        check(not page.locator("#candidate-controls").is_visible(), "larger k uses candidate table only")
        check(page.locator("#matrix-candidates tbody tr").count() == default["p"], "one row per secret candidate")
        feature_layout(page, width, "k" + str(dimension) + "-candidates", layouts, ("matrix-table",))


def test_dealer(page, width, layouts, vectors, language):
    click_visible(page, "k2-start")
    show_details(page, "dealer")
    normal = page.locator('#dealer [data-i18n="normalName"]')
    check(normal.is_visible() and not normal.evaluate("el=>!!el.closest('#advanced')"),
          "normal definition is available before advanced settings")
    for key in ("dealerIntro", "coordinatesIntro", "randomnessPlain"):
        readable_copy(page, '#dealer [data-i18n="' + key + '"]')
    show_details(page, "advanced")
    page.locator("#share-count").select_option("8")
    page.wait_for_function("() => !document.querySelector('#generate').disabled")
    page.locator("#secret").fill("12")
    page.locator("#secret").press("Tab")
    page.locator("#prime").select_option("7")
    page.wait_for_function("() => !document.querySelector('#generate').disabled")
    check(page.locator("#share-count").input_value() == "6", "n clamps to p-1")
    check(page.locator("#secret").input_value() == "6", "s clamps to p-1")
    check(page.locator("#coordinates input").evaluate_all("els => els.every(el => Number(el.value) >= 0 && Number(el.value) < 7)"),
          "all random coordinates in field")
    generated_label = "乱数で作った例" if language == "ja" else "Randomly generated example"
    check(page.locator("#example-kind").inner_text() == generated_label, "p change produces fresh example")
    page.locator("#method").select_option("vandermonde")
    page.wait_for_function("() => !document.querySelector('#generate').disabled")
    inspection = page.locator("#inspection-list")
    open_ancestors(inspection)
    check("✗" not in inspection.inner_text(), "Vandermonde passes")
    page.locator("#method").select_option("random")
    page.wait_for_function("() => !document.querySelector('#generate').disabled")
    check(page.locator("#example-kind").inner_text() == generated_label, "returning to random does not restore fixed example")
    first_coordinate = page.locator("#coordinates input").first
    first_coordinate.fill("-1")
    first_coordinate.press("Tab")
    check(bool(page.locator("#status").inner_text()), "invalid coordinate is reported")
    first_coordinate.fill("0" if first_coordinate.input_value() != "0" else "1")
    first_coordinate.press("Tab")
    check(page.locator("#manual-note").is_visible(), "manual entry outside uniform guarantee")
    check(not page.locator("#status").inner_text(), "valid manual entry clears prior error")
    feature_layout(page, width, "dealer-settings", layouts, ("main-grid",))
    click_visible(page, "reset-default")
    default = vectors["default_k2"]
    check(page.locator("#prime").input_value() == str(default["p"]), "reset restores default prime")
    check(page.locator("#share-count").input_value() == str(len(default["A"])), "reset restores default n")
    check(page.locator("#secret").input_value() == str(default["X"][0]), "reset restores default s")
    check(not page.locator("#manual-note").is_visible(), "reset clears manual warning")


def test_stage1b(page, width, layouts, language):
    vectors = json.loads((ROOT / "test" / "vectors.json").read_text(encoding="utf-8"))
    test_k2(page, width, layouts, vectors, language)
    test_k3(page, width, layouts, vectors)
    test_matrices(page, width, layouts, vectors)
    test_dealer(page, width, layouts, vectors, language)




def readable_copy(page, selector):
    element = page.locator(selector)
    check(element.is_visible(), ("explanation is visible", selector))
    text = element.inner_text().strip()
    check(bool(text) and not re.search(r"\{[a-zA-Z][a-zA-Z0-9_]*\}", text),
          ("explanation has resolved text", selector, text))
    check("???" not in text and "\ufffd" not in text, ("explanation is not encoding-damaged", selector, text))
    check(not re.fullmatch(r"[a-z]+(?:[A-Z][A-Za-z0-9]*)+", text),
          ("dynamic explanation does not display a translation key", selector, text))
    key = element.get_attribute("data-i18n")
    check(not key or text != key, ("translation key is not shown", selector))
    return text


def secret_candidate_count(text):
    match = re.search(r"(?:\u79d8\u5bc6\u306e)?\u5019\u88dc(?:\u306f)?\s*(\d+)\s*\u500b|"
                      r"(\d+)\s+secret candidates", text, re.IGNORECASE)
    check(match is not None, ("display identifies a secret candidate count", text))
    return int(next(value for value in match.groups() if value is not None))


def matrix_reading(page, expected_row, prime):
    text = readable_copy(page, "#matrix-intro")
    terms = re.findall(r"(\d+)x([\u2081-\u2085])", text)
    indices = [ord(index) - ord("\u2081") for _, index in terms]
    check(indices == list(range(len(expected_row) - 1)), "row explanation names each displayed variable")
    check([int(value) for value, _ in terms] == expected_row[:-1], "row explanation uses current matrix coefficients")
    rhs = re.search(r"\u2261\s*(\d+)\s*\(mod\s+(\d+)\)", text)
    check(rhs is not None and [int(x) for x in rhs.groups()] == [expected_row[-1], prime],
          "row explanation uses the current right-hand value and field")


def visible_coordinate_pairs(text):
    return [[int(a), int(b)] for a, b in re.findall(r"\((\d+)\s*,\s*(\d+)\)", text)]


def integers(text):
    return [int(value) for value in re.findall(r"-?\d+", text)]


def compare_table(page, expected):
    rows = table_rows(page, "compare-table")
    check(len(rows) == len(expected), ("comparison row count", len(rows), len(expected)))
    for row, coefficients in zip(rows, expected):
        check(integers(row[0]) == [coefficients[0]], ("comparison secret", row))
        check(integers(row[1]) == coefficients, ("comparison coefficients", row, coefficients))
        check([int(value) for value in row[-2:]] == [11, 8], ("all rows reproduce both shares", row))
    return rows


def compare_selection(page, coefficients):
    secret = coefficients[0]
    check(page.locator("#compare-pick-" + str(secret)).get_attribute("aria-pressed") == "true", "selected comparison row")
    check(page.locator("#compare-rows button[aria-pressed='true']").count() == 1, "one selected comparison row")
    for identifier in ("compare-poly", "compare-slice"):
        check(page.locator("#" + identifier).get_attribute("data-candidate") == str(secret), (identifier, secret))
        check(data_json(page, identifier, "coefficients") == coefficients, (identifier, coefficients))
    check(data_json(page, "compare-slice", "point") == coefficients[1:], "slice and polynomial select same coefficients")
    expected = [[x, sum(value * x ** power for power, value in enumerate(coefficients)) % 13] for x in range(13)]
    check(point_data(page, "compare-poly") == expected, "selected polynomial evaluations")
    marks = page.locator("#compare-poly .compare-poly-point").evaluate_all(
        "nodes => nodes.map(node => JSON.parse(node.dataset.point))")
    check(marks == expected, "all selected polynomial dots are rendered")
    check(data_json(page, "compare-slice", "intersections") == [coefficients[1:]], "selected slice intersection")


def test_compare(page, width, layouts, vectors):
    page.locator("#tab-compare").click()
    assert_selected(page, "compare")
    expected_k2 = vectors["shamir_k2"]["line1"]
    known = {}
    for dimension, vector_key, observed in ((2, "shamir_k2", 1), (3, "shamir", 2)):
        source = "compare-k" + str(dimension) + "-source"
        identifier = "compare-k" + str(dimension) + "-shares"
        model = vectors[vector_key]
        check(page.locator("#" + source).get_attribute("open") is None, "dealer's full comparison distribution starts collapsed")
        known[identifier] = readable_copy(page, "#" + identifier)
        check(visible_coordinate_pairs(known[identifier]) == [[i + 1, value] for i, value in enumerate(model["c"][:observed])],
              "comparison exposes only the observed one or two shares")
        check(not page.locator("#compare-k" + str(dimension) + "-all-shares").is_visible(), "unobserved shares are not presented as known")
        show_details(page, source)
        all_shares = readable_copy(page, "#compare-k" + str(dimension) + "-all-shares")
        check(visible_coordinate_pairs(all_shares) == [[i + 1, value] for i, value in enumerate(model["c"])],
              "optional dealer detail retains the whole original distribution")
        page.locator("#" + source + ">summary").click()
    for key in ("compareBasics", "compareRandomRoles", "compareCandidateMeaning", "compareK2Task", "compareK3Task", "compareViews"):
        readable_copy(page, '#panel-compare [data-i18n="' + key + '"]')
    check(sorted_points(point_data(page, "compare-k2-grid")) == sorted_points(expected_k2), "k2 comparison vector points")
    initial = int(page.locator("#compare-k2-grid").get_attribute("data-candidate"))
    check(data_json(page, "compare-k2-grid", "point") == expected_k2[initial], "k2 comparison selected point")
    page.locator("#compare-k2-next").click()
    check(int(page.locator("#compare-k2-grid").get_attribute("data-candidate")) == (initial + 1) % 13, "k2 comparison advances")
    page.locator("#compare-k2-prev").click()
    check(int(page.locator("#compare-k2-grid").get_attribute("data-candidate")) == initial, "k2 comparison returns")
    open_ancestors(page.locator("#compare-linear-table"))
    linear = table_rows(page, "compare-linear-table")
    check(len(linear) == 13, "13 linear correspondences")
    for row, point in zip(linear, expected_k2):
        check(integers(row[0]) == [point[0]], ("linear candidate", row))
        check(any(integers(cell) == point for cell in row[1:]), ("linear coefficient point", row, point))
    expected = vectors["shamir"]["line12"]
    rows = compare_table(page, expected)
    check(page.locator("#compare-zero-top").is_visible(), "zero leading coefficient is visible")
    zero = vectors["shamir"]["zeroTop"][0]
    check(zero == [1, 10, 0], "zero coefficient reference")
    polynomial = ''.join(rows[zero[0]][2].split()).replace('\uff0b', '+')
    check('1+10x' in polynomial, ("zero leading coefficient becomes linear", polynomial))
    for coefficients in expected:
        page.locator("#compare-pick-" + str(coefficients[0])).click()
        compare_selection(page, coefficients)
    feature_layout(page, width, "compare-all-13", layouts,
                   ("compare-k2-grid", "compare-linear-table", "compare-poly", "compare-table", "compare-slice", "compare-size-table"))
    boxes = {name: page.locator("#compare-" + name + "-panel").bounding_box() for name in ("poly", "table", "slice")}
    if width < 720:
        check(boxes["poly"]["y"] + boxes["poly"]["height"] <= boxes["slice"]["y"] + 1, "mobile polynomial directly precedes slice")
        gap = boxes["slice"]["y"] - (boxes["poly"]["y"] + boxes["poly"]["height"])
        check(0 <= gap <= 48, "mobile linked diagrams have no intervening table")
        check(boxes["slice"]["y"] + boxes["slice"]["height"] <= boxes["table"]["y"] + 1, "mobile correspondence table follows both diagrams")
    else:
        check(abs(boxes["poly"]["y"] - boxes["slice"]["y"]) <= 1, "desktop diagrams in same row")
        check(boxes["poly"]["x"] + boxes["poly"]["width"] <= boxes["slice"]["x"] + 1, "desktop diagrams in two columns")
    page.locator("#compare-nonzero").check()
    filtered = [row for row in expected if all(value != 0 for value in row[1:])]
    check(len(filtered) == 11 and {row[0] for row in expected} - {row[0] for row in filtered} == {1, 12}, "nonzero restriction reference")
    compare_table(page, filtered)
    for secret in (1, 12):
        check(not page.locator("#compare-pick-" + str(secret)).count(), ("nonzero restriction removes candidate", secret))
    current = int(page.locator("#compare-poly").get_attribute("data-candidate"))
    compare_selection(page, next(row for row in filtered if row[0] == current))
    page.locator("#compare-pick-5").focus()
    page.keyboard.press("ArrowDown")
    compare_selection(page, expected[6])
    page.keyboard.press("Home")
    compare_selection(page, expected[0])
    page.keyboard.press("End")
    compare_selection(page, expected[11])
    feature_layout(page, width, "compare-nonzero-11", layouts, ("compare-poly", "compare-table", "compare-slice"))
    for identifier, text in known.items():
        check(page.locator("#" + identifier).inner_text() == text, "testing and filtering candidates does not change observed shares")
    page.locator("#compare-nonzero").uncheck()
    compare_table(page, expected)
    size_rows = table_rows(page, "compare-size-table")
    check([[int(value) for value in row[-2:]] for row in size_rows] == [[3, 48], [3, 18], [1, 16]], "share size values")
    page.locator("#compare-pick-1").click()
    compare_selection(page, zero)
    page.locator("#compare-lesson").click()
    check(page.locator("#help-dialog").is_visible(), "comparison link opens help")
    check(page.locator("#lesson-8").evaluate("el => el.open"), "comparison link opens requested lesson")
    check(page.locator("#lesson-8 > summary").evaluate("el => el === document.activeElement"), "comparison lesson gets focus")
    page.keyboard.press("Escape")
    check(page.locator("#compare-lesson").evaluate("el => el === document.activeElement"), "comparison help restores opener focus")



def test_pitfall_b(page, width, layouts, vectors):
    for k in (2, 3):
        page.locator("#pit-b-k" + str(k)).click()
        model = vectors["default_k" + str(k)]
        prime = model["p"]
        expected_rows = [[count, prime ** (k - count), prime if count < k else 1] for count in range(k + 1)]
        check([[int(cell) for cell in row] for row in table_rows(page, "pit-b-table")] == expected_rows,
              ("whole point versus first coordinate counts", k))
        for count, whole, secrets in expected_rows:
            page.locator("#pit-b-count-" + str(count)).click()
            check(page.locator("#pit-b-count-" + str(count)).get_attribute("aria-pressed") == "true", "whole point count selected")
            check(integers(page.locator("#pit-b-unsafe").inner_text())[0] == whole, ("selected whole count", whole))
            check(integers(page.locator("#pit-b-result").inner_text())[-1] == secrets, ("selected secret count", secrets))
            expected = field_points(model["A"][:count], model["c"][:count], prime, k)
            check(len(expected) == whole, ("whole point oracle", k, count))
            if k == 2:
                check(sorted_points(point_data(page, "pit-b-grid")) == sorted_points(expected), ("whole point rendered set", count))
            else:
                figures = page.locator("#pit-b-slices figure")
                check(figures.count() == prime, "whole point slice figure count")
                for secret in range(prime):
                    expected_count = sum(point[0] == secret for point in expected)
                    figure = figures.nth(secret)
                    check(figure.get_attribute("data-s") == str(secret), "whole point slice order")
                    check(figure.get_attribute("data-count") == str(expected_count), ("whole point slice count", count, secret))
                    check(figure.locator(".slice-dot").count() == expected_count, ("whole point slice rendered dots", count, secret))
            feature_layout(page, width, "pit-b-k" + str(k) + "-count" + str(count), layouts,
                           ("pit-b-grid", "pit-b-table", "pit-b-slices"))


def test_pitfall_c(page, width, layouts, vectors):
    model = vectors["default_k2"]
    page.locator("#pit-c-mode").select_option("integer")
    for index, row in enumerate(model["A"]):
        page.locator("#pit-c-share").select_option(str(index))
        expected = [[x, y] for x, y in product(range(model["p"]), repeat=2)
                    if row[0] * x + row[1] * y == model["cInt"][index]]
        check([point[0] for point in expected] == model["integerCandidates"][index], "integer candidate reference")
        check(sorted_points(point_data(page, "pit-c-grid")) == sorted_points(expected), ("integer points", index))
        open_ancestors(page.locator("#pit-c-table"))
        check([[int(cell) for cell in values] for values in table_rows(page, "pit-c-table")] == expected, ("integer point table", index))
        check(str(model["cInt"][index]) in page.locator("#pit-c-equation").inner_text(), "integer RHS stays unreduced")
        check(integers(page.locator("#pit-c-unsafe").inner_text()) == [len(expected), *[point[0] for point in expected]],
              ("integer reported candidates", index))
        complete = field_points([row], [model["c"][index]], model["p"])
        complete_secrets = {point[0] for point in complete}
        check(len(complete_secrets) == model["p"], "full-field comparison independently covers every secret")
        check(secret_candidate_count(page.locator("#pit-c-result").inner_text()) == len(complete_secrets),
              "displayed alternative-model candidate count equals the full-field oracle")
        feature_layout(page, width, "pit-c-integer" + str(index), layouts, ("pit-c-grid", "pit-c-table"))
    page.locator("#pit-c-mode").select_option("narrow")
    expected = [point for point in model["lines"][0] if point[1] <= 3]
    check(len(expected) == 4, "narrow candidate reference")
    check(sorted_points(point_data(page, "pit-c-grid")) == sorted_points(expected), "narrow random coordinates")
    check([[int(cell) for cell in row] for row in table_rows(page, "pit-c-table")] == expected, "narrow point table")
    check(not page.locator("#pit-c-share").is_visible(), "narrow model uses fixed first share")
    check(integers(page.locator("#pit-c-unsafe").inner_text()) == [4, *[point[0] for point in expected]], "narrow reported candidates")
    complete = field_points(model["A"][:1], model["c"][:1], model["p"])
    check(secret_candidate_count(page.locator("#pit-c-result").inner_text()) == len({point[0] for point in complete}),
          "narrow model is compared against all independently enumerated full-field secrets")
    feature_layout(page, width, "pit-c-narrow", layouts, ("pit-c-grid", "pit-c-table"))


def test_pitfall_a(page, width, layouts, vectors):
    for mode, key in (("vertical", "leak_k2"), ("leak3", "leak_k3"), ("parallel", "parallel_k2"), ("short", None)):
        page.locator("#pit-a-mode").select_option(mode)
        model = vectors[key] if key else {
            "p": 13, "A": vectors["default_k2"]["A"][:1], "c": vectors["default_k2"]["c"][:1]
        }
        expected = field_points(model["A"], model["c"], model["p"])
        secrets = sorted({point[0] for point in expected})
        check(data_json(page, "pit-a-grid", "secrets") == secrets, ("unchecked secret candidates", mode))
        check(int(page.locator("#pit-a-grid").get_attribute("data-solution-count")) == len(expected), ("unchecked point count", mode))
        if key:
            expected_counts = [sum(point[0] == secret for point in expected) for secret in range(model["p"])]
            check(expected_counts == model["sCandidates"], ("unchecked count reference", mode))
            bad = [[value + 1 for value in row] for row in model.get("badI", model.get("checkBadII", [[0]]))]
            failed = [integers(row[0]) for row in table_rows(page, "pit-a-checks") if '\u2717' in row[-1]]
            check(failed == bad, ("failed normal subsets", mode, failed, bad))
        if mode == "leak3":
            check(page.locator("#pit-a-slices button").count() == model["p"], "leaking slice count")
            for secret in range(model["p"]):
                slice_expected = [point[1:] for point in expected if point[0] == secret]
                check(sorted_points(point_data(page, "pit-a-slice-" + str(secret))) == sorted_points(slice_expected),
                      ("leaking slice points", secret))
                page.locator("#pit-a-s").select_option(str(secret))
                check(page.locator("#pit-a-slice-" + str(secret)).get_attribute("aria-pressed") == "true", "leaking slice selected")
                marked = page.locator("#pit-a-grid .grid-overlap[data-point]").evaluate_all(
                    "nodes => nodes.map(node => node.dataset.point.split(',').map(Number))")
                check(sorted_points(marked) == sorted_points(slice_expected), ("leaking selected slice intersections", secret))
            page.locator("#pit-a-slice-7").click()
            check(page.locator("#pit-a-s").input_value() == "7", "slice button and select synchronize")
        else:
            check(sorted_points(point_data(page, "pit-a-grid")) == sorted_points(expected), ("unchecked 2D points", mode))
        if mode in ("parallel", "short"):
            returned = re.search(r"\((\d+)\s*,\s*(\d+)\)", page.locator("#pit-a-unsafe").inner_text())
            check(returned is not None, ("unprotected returned point", mode))
            check([int(value) for value in returned.groups()] == ([0, 0] if mode == "parallel" else [3, 0]),
                  ("unprotected solver output", mode))
        check(page.locator("#pit-card-a .real-line").count() == 0, "unchecked models omit real-line diagram")
        feature_layout(page, width, "pit-a-" + mode, layouts, ("pit-a-grid", "pit-a-slices", "pit-a-checks"))


def tamper_rows(page):
    return [{"T": integers(row[0]), "X": integers(row[1]), "s": int(row[2])} for row in table_rows(page, "pit-d-table")]


def test_pitfall_d(page, width, layouts, vectors):
    model = vectors["default_k2"]
    page.locator("#pit-d-count").select_option("2")
    for delta, secret in enumerate(vectors["tamper_linearity"]["sByDelta"]):
        page.locator("#pit-d-delta").select_option(str(delta))
        rhs = [model["c"][0], (model["c"][1] + delta) % model["p"]]
        expected = field_points(model["A"][:2], rhs, model["p"])
        check(len(expected) == 1 and expected[0][0] == secret, ("tamper linearity reference", delta))
        check(tamper_rows(page) == [{"T": [1, 2], "X": expected[0], "s": secret}], ("delta restores altered point", delta))
        check(data_json(page, "pit-d-result", "suspects") == [], "two shares cannot identify alteration")
    open_ancestors(page.locator("#pit-d-linearity"))
    check([[int(cell) for cell in row] for row in table_rows(page, "pit-d-linearity")] ==
          [[delta, secret] for delta, secret in enumerate(vectors["tamper_linearity"]["sByDelta"])], "all delta table")
    page.locator("#pit-d-delta").select_option("1")
    for count in (2, 3, 4):
        page.locator("#pit-d-count").select_option(str(count))
        expected = [{**pair, "s": pair["X"][0]} for pair in vectors["tamper_k2"]["pairs"] if max(pair["T"]) <= count]
        rows = tamper_rows(page)
        check(rows == expected, ("tampered subset intersections", count))
        check(data_json(page, "pit-d-result", "suspects") == ([1] if count == 4 else []), ("suspect identification threshold", count))
        if count == 3:
            check(len({tuple(row["X"]) for row in rows}) == 3, "three different pair intersections")
        if count == 4:
            check(sum(row["X"] == model["X"] for row in rows) == 3, "three honest pairs agree")
        feature_layout(page, width, "pit-d-count" + str(count), layouts, ("pit-d-grid", "pit-d-table", "pit-d-linearity"))
    page.locator("#pit-d-delta").select_option("0")
    check(all(row["X"] == model["X"] for row in tamper_rows(page)), "delta zero restores all original intersections")
    check(data_json(page, "pit-d-result", "suspects") == [], "delta zero has no suspect")
    check(page.locator("#pit-card-d .real-line").count() == 0, "tampering omits real-line diagram")


def test_pitfalls(page, width, layouts, vectors):
    page.locator("#tab-pitfalls").click()
    assert_selected(page, "pitfalls")
    cards = page.locator("#panel-pitfalls > section").evaluate_all("nodes => nodes.map(node => node.id)")
    check(cards == ["pit-card-b", "pit-card-c", "pit-card-a", "pit-card-d"], "pitfall teaching order")
    for suffix in ("b", "c"):
        card = page.locator("#pit-card-" + suffix)
        check(card.locator('[data-i18n="pitChecked"]').count() == 0, "alternative model comparison is not labelled as an input check")
        readable_copy(page, '#pit-card-' + suffix + ' [data-i18n="pit' + suffix.upper() + 'Comparison"]')
        readable_copy(page, '#pit-card-' + suffix + ' [data-i18n="pit' + suffix.upper() + 'Task"]')
    readable_copy(page, '[data-i18n="pitTamperAuthentication"]')
    for suffix in ("b", "c", "a", "d"):
        card = page.locator("#pit-card-" + suffix)
        check(card.locator("h4").count() == 4, ("four teaching headings", suffix))
        check('\u2715' in card.locator(".danger-badge").inner_text(), ("deliberately unprotected badge", suffix))
        border = card.locator(".danger-model").evaluate("el => parseFloat(getComputedStyle(el).borderLeftWidth)")
        check(border >= 4, ("thick warning border", suffix, border))
    test_pitfall_b(page, width, layouts, vectors)
    test_pitfall_c(page, width, layouts, vectors)
    test_pitfall_a(page, width, layouts, vectors)
    test_pitfall_d(page, width, layouts, vectors)


def test_lessons(page, width, layouts, language):
    page.locator("#help").click()
    dialog = page.locator("#help-dialog")
    check(dialog.is_visible(), "lessons are inside open help")
    check(dialog.locator("details[id^='lesson-']").count() == 10, "ten lessons")
    for key in ("helpLearningRoute", "helpTheoryRoute"):
        readable_copy(page, '#help-dialog [data-i18n="' + key + '"]')
    glossary = dialog.locator('.beginner-glossary')
    check(glossary.is_visible() and glossary.locator('dt').count() == 8 and glossary.locator('dd').count() == 8,
          "eight beginner terms are visible without opening theory lessons")
    check(glossary.evaluate("el=>!!(el.compareDocumentPosition(document.querySelector('#lessons'))&Node.DOCUMENT_POSITION_FOLLOWING)"),
          "beginner vocabulary precedes advanced lessons")
    feature_layout(page, width, "help-beginner-guide", layouts, ())
    for number in range(1, 11):
        identifier = "lesson-" + str(number)
        lesson = page.locator("#" + identifier)
        show_details(page, identifier)
        heading = lesson.locator(":scope > summary").inner_text().strip()
        check(bool(heading), ("lesson heading", number))
        if language == "en":
            check(not re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", heading), ("English heading", heading))
        check(lesson.locator("table").count() >= 1, ("lesson has a table", number))
        check(lesson.locator("a[href]").count() >= 1, ("lesson has source or tool links", number))
        for href in lesson.locator("a[href]").evaluate_all("links => links.map(link => link.getAttribute('href'))"):
            check(href.startswith("https://"), ("lesson HTTPS source", number, href))
        feature_layout(page, width, "lesson-" + str(number), layouts, (identifier,))
    check(page.locator("#lesson-10 a[href]").count() >= 4, "four related tools")
    focusable = dialog.locator("button, a[href], input, select, textarea, summary, [tabindex='0']").filter(visible=True)
    first = focusable.first
    last = focusable.last
    first.focus()
    page.keyboard.press("Shift+Tab")
    check(last.evaluate("el => el === document.activeElement"), "help wraps from first to last")
    page.keyboard.press("Tab")
    check(first.evaluate("el => el === document.activeElement"), "help wraps from last to first")
    page.keyboard.press("Escape")
    check(not dialog.is_visible(), "Escape closes expanded lessons")
    check(page.locator("#help").evaluate("el => el === document.activeElement"), "expanded lessons restore help focus")
    public_text = page.locator("main").text_content()
    forbidden = r"e\u2081|\u5c04\u5f71|\u5f27|\bMDS\b|\bprojection\b|\bspan\b"
    check(not re.search(forbidden, public_text, re.IGNORECASE), "advanced terminology stays inside lessons")


def test_stage1c(page, width, layouts, language):
    vectors = json.loads((ROOT / "test" / "vectors.json").read_text(encoding="utf-8"))
    test_compare(page, width, layouts, vectors)
    test_pitfalls(page, width, layouts, vectors)
    test_lessons(page, width, layouts, language)



def field_points(A, c, prime, dimension=None):
    """Small independent exhaustive oracle; no product code or browser API is called."""
    dimension = dimension or len(A[0])
    return [list(point) for point in product(range(prime), repeat=dimension)
            if all(sum(a * x for a, x in zip(row, point)) % prime == rhs % prime for row, rhs in zip(A, c))]


def http_smoke_case(browser, browser_name, url, width, output):
    context = new_context(browser, browser_name, width, "en", "dark")
    page = context.new_page()
    errors = observe(page, url)
    layouts = []
    name = browser_name + "-" + str(width) + "-http-smoke"
    try:
        page.goto(url, wait_until="load")
        vectors = json.loads((ROOT / "test" / "vectors.json").read_text(encoding="utf-8"))
        assert_preference(page, "en", "dark")
        check(sorted_points(point_data(page, "main-grid")) == sorted_points(vectors["default_k2"]["lines"][0]), "HTTP main graph")
        assert_layout(page, width, "http-initial", layouts)
        test_math_primer(page, width, layouts, vectors["default_k2"])
        page.locator("#tab-compare").click()
        expected = vectors["shamir"]["line12"]
        compare_table(page, expected)
        page.locator("#compare-pick-1").click()
        compare_selection(page, vectors["shamir"]["zeroTop"][0])
        page.locator("#compare-nonzero").check()
        compare_table(page, [row for row in expected if all(value != 0 for value in row[1:])])
        feature_layout(page, width, "http-compare", layouts, ("compare-poly", "compare-table", "compare-slice"))
        page.locator("#tab-pitfalls").click()
        page.locator("#pit-d-count").select_option("4")
        page.locator("#pit-d-delta").select_option("1")
        check(len(table_rows(page, "pit-d-table")) == 6, "HTTP six pair results")
        feature_layout(page, width, "http-pitfalls", layouts, ("pit-d-grid", "pit-d-table"))
        page.locator("#help").click()
        check(page.locator("#help-dialog details[id^='lesson-']").count() == 10, "HTTP ten lessons")
        show_details(page, "lesson-10")
        assert_layout(page, width, "http-help", layouts)
        page.keyboard.press("Escape")
        page.locator("#language").click()
        page.locator("#theme").click()
        assert_preference(page, "ja", "light")
        assert_clean(page, errors)
        page.screenshot(path=str(output / (name + ".png")), full_page=False)
        return {"case": name, "status": "passed", "url": url, "layouts": layouts}
    except Exception as error:
        page.screenshot(path=str(output / (name + "-failed.png")), full_page=False)
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "layouts": layouts}
    finally:
        context.close()


def data_json(page, identifier, name):
    raw = page.locator("#" + identifier).get_attribute("data-" + name)
    check(raw is not None, (identifier, name))
    return json.loads(raw)


def table_rows(page, identifier):
    return page.locator("#" + identifier + " tbody tr").evaluate_all(
        "rows => rows.map(row => Array.from(row.querySelectorAll('th, td'), cell => cell.textContent.trim()))"
    )


@contextmanager
def local_http():
    """Serve the repository on an ephemeral loopback port without installing anything."""
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:" + str(server.server_address[1]) + "/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def new_context(browser, browser_name, width, language, theme):
    options = {
        "viewport": {"width": width, "height": 900},
        "locale": "ja-JP" if language == "ja" else "en-US",
        "color_scheme": theme, "reduced_motion": "reduce",
        "has_touch": browser_name == "chromium" and width < 720,
    }
    if browser_name == "chromium":
        options["is_mobile"] = width < 720
    return browser.new_context(**options)


def matrix_case(browser, browser_name, url, width, language, theme, output, stage):
    case_name = f"{browser_name}-{width}-{language}-{theme}"
    context = new_context(browser, browser_name, width, language, theme)
    page = context.new_page()
    errors = observe(page, url)
    layouts = []
    try:
        page.goto(set_language_query(url, None), wait_until="load")
        page.wait_for_function("() => !!document.querySelector('#tab-intersections').textContent")
        check(page.title() == "BlakleySharing CipherLab", "document title")
        check(page.locator("main").count() == 1, "single main")
        check(page.locator('meta[name="viewport"]').get_attribute("content")
              == "width=device-width, initial-scale=1", "viewport")
        check(page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute("content") == CSP, "CSP")
        check(page.locator('meta[name="referrer"]').get_attribute("content") == "no-referrer", "referrer")
        assert_preference(page, language, theme)
        check(page.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches"), "reduced motion")
        assert_layout(page, width, "initial", layouts)
        page.screenshot(path=str(output / (case_name + "-initial.png")), full_page=False)
        test_tabs(page, width, layouts)
        test_help(page, width, layouts, output / (case_name + "-help.png"))
        coordinate_ui = None
        if stage in ("1b", "1c"):
            coordinate_ui = test_coordinate_ui(page, width, layouts, language)
            test_stage1b(page, width, layouts, language)
        if stage == "1c":
            test_stage1c(page, width, layouts, language)
        saved = test_preferences_interaction(page, language, theme)
        assert_clean(page, errors)
        return {"case": case_name, "status": "passed", "layouts": layouts, "saved": saved, "coordinate_ui": coordinate_ui}
    except Exception as error:
        page.screenshot(path=str(output / (case_name + "-failed.png")), full_page=False)
        return {"case": case_name, "status": "failed", "error": str(error),
                "errors": errors, "layouts": layouts}
    finally:
        context.close()


def precedence_cases(browser, browser_name, url):
    cases = (
        ("saved-en", "ja", "light", {"language": "en", "theme": "dark"}, None, "en", "dark"),
        ("saved-ja", "en", "dark", {"language": "ja", "theme": "light"}, None, "ja", "light"),
        ("query-ja", "en", "light", {"language": "en", "theme": "dark"}, "ja", "ja", "dark"),
        ("query-en", "ja", "dark", {"language": "ja", "theme": "light"}, "en", "en", "light"),
        ("invalid-query", "ja", "light", {"language": "en", "theme": "dark"}, "xx", "en", "dark"),
        ("invalid-saved", "en", "dark", {"language": "xx", "theme": "xx"}, None, "en", "dark"),
        ("blocked-storage", "ja", "dark", None, None, "ja", "dark"),
    )
    results = []
    for name, locale, system_theme, stored, query, language, theme in cases:
        context = new_context(browser, browser_name, 390, locale, system_theme)
        if stored is None:
            context.add_init_script("""Object.defineProperty(window, 'localStorage', {
              get() { throw new DOMException('Unavailable for test', 'SecurityError'); }
            });""")
        else:
            values = {PREFIX + key: value for key, value in stored.items()}
            context.add_init_script("""(() => {
              const saved = """ + json.dumps(values) + """;
              for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
            })();""")
        page = context.new_page()
        errors = observe(page, url)
        try:
            page.goto(set_language_query(url, query), wait_until="load")
            assert_preference(page, language, theme)
            page.locator("#language").click()
            page.locator("#theme").click()
            assert_preference(page, "en" if language == "ja" else "ja",
                              "dark" if theme == "light" else "light")
            assert_clean(page, errors)
            results.append({"case": browser_name + "-" + name, "status": "passed"})
        except Exception as error:
            results.append({"case": browser_name + "-" + name, "status": "failed",
                            "error": str(error), "errors": errors})
        finally:
            context.close()
    return results


def keyboard_to(page, identifier, key="Tab", limit=100):
    path = []
    for _ in range(limit):
        active = page.evaluate("() => document.activeElement.id || document.activeElement.tagName.toLowerCase()")
        path.append(active)
        if active == identifier:
            return path
        page.keyboard.press(key)
    raise AssertionError(("keyboard target unreachable", identifier, path))


def keyboard_case(browser, browser_name, url, output, stage="1b"):
    context = new_context(browser, browser_name, 390, "ja", "light")
    page = context.new_page()
    errors = observe(page, url)
    try:
        page.goto(set_language_query(url, None), wait_until="load")
        first = keyboard_to(page, "candidate-next")
        before = page.locator("#candidate-value").inner_text()
        page.keyboard.press("Enter")
        check(page.locator("#candidate-value").inner_text() != before, "keyboard advances candidate")
        points = point_data(page, "main-grid")
        check(len(points) == 13 and len({point[0] for point in points}) == 13, "keyboard wow: all 13 columns")
        second = keyboard_to(page, "k3-start")
        page.keyboard.press("Enter")
        vectors = json.loads((ROOT / "test" / "vectors.json").read_text(encoding="utf-8"))
        check_slices(page, vectors["default_k3"]["slices12"])
        third = keyboard_to(page, "pick-2", key="Shift+Tab")
        page.keyboard.press("Enter")
        check_slices(page, vectors["default_k3"]["slices123"])
        routes = {"one-line-13-columns": first, "k3-start": second, "third-share": third}
        page.screenshot(path=str(output / (browser_name + "-keyboard-k3.png")), full_page=False)
        if stage == "1c":
            routes["comparison-tab"] = keyboard_to(page, "tab-intersections", key="Shift+Tab")
            page.keyboard.press("ArrowRight")
            assert_selected(page, "compare")
            routes["comparison-11-and-8"] = keyboard_to(page, "compare-pick-5")
            page.keyboard.press("Enter")
            compare_table(page, vectors["shamir"]["line12"])
            compare_selection(page, vectors["shamir"]["X"])
            page.screenshot(path=str(output / (browser_name + "-keyboard-compare.png")), full_page=False)
        assert_clean(page, errors)
        return {"case": browser_name + "-keyboard-routes", "status": "passed", "routes": routes}
    except Exception as error:
        return {"case": browser_name + "-keyboard-routes", "status": "failed",
                "error": str(error), "errors": errors}
    finally:
        context.close()


def real_touch_case(browser, width, url, output):
    """Use trusted Chromium touch input, including native vertical page scrolling."""
    context = new_context(browser, "chromium", width, "ja", "light")
    page = context.new_page()
    errors = observe(page, url)
    case_name = "chromium-" + str(width) + "-real-touch"
    evidence = {}
    try:
        page.goto(set_language_query(url, None), wait_until="load")
        page.locator("#k3-start").click()
        page.evaluate("""() => {
          window.__qaTouch = [];
          for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
            'gotpointercapture', 'lostpointercapture']) {
            document.addEventListener(name, event => window.__qaTouch.push({
              name, type: event.pointerType, trusted: event.isTrusted,
              x: event.clientX, y: event.clientY, target: event.target.tagName, scroll: scrollY
            }), true);
          }
        }""")
        cdp = context.new_cdp_session(page)
        test_grid_touch(page, cdp, width, evidence)
        page.locator("#k3-start").click()
        camera = """() => ({
          scroll: scrollY, yaw: Number(document.querySelector('#scene').dataset.yaw),
          pitch: Number(document.querySelector('#scene').dataset.pitch)
        })"""
        for kind in ("horizontal", "vertical"):
            page.locator("#camera-reset").click()
            page.locator("#scene").evaluate("el => el.scrollIntoView({block: 'center'})")
            bounds = page.locator("#scene").bounding_box()
            start_x = bounds["x"] + bounds["width"] * (.3 if kind == "horizontal" else .5)
            start_y = bounds["y"] + bounds["height"] * (.5 if kind == "horizontal" else .8)
            delta_x = bounds["width"] * .4 if kind == "horizontal" else 0
            delta_y = 0 if kind == "horizontal" else -bounds["height"] * .6
            check(0 < start_x < width and 0 < start_y < 900, "touch starts inside viewport")
            hit = page.evaluate("""([x, y]) =>
              document.querySelector('#scene').contains(document.elementFromPoint(x, y))""", [start_x, start_y])
            check(hit, "touch starts on scene")
            before = page.evaluate(camera)
            page.evaluate("() => { window.__qaTouch = []; }")
            point = {"x": start_x, "y": start_y, "id": 7, "radiusX": 3, "radiusY": 3, "force": 1}
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [point]})
            for step in range(1, 9):
                point = {**point, "x": start_x + delta_x * step / 8, "y": start_y + delta_y * step / 8}
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [point]})
                page.wait_for_timeout(20)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            page.wait_for_timeout(80)
            after = page.evaluate(camera)
            events = page.evaluate("() => window.__qaTouch")
            evidence[kind] = {"box": bounds, "start": [start_x, start_y],
                              "delta": [delta_x, delta_y], "before": before, "after": after, "events": events}
            touch_events = [event for event in events if event["type"] == "touch" and event["trusted"]]
            names = [event["name"] for event in touch_events]
            check("pointerdown" in names and "pointermove" in names, "trusted touch input reaches page")
            if kind == "horizontal":
                check(after["yaw"] != before["yaw"] and after["pitch"] == before["pitch"], "real touch changes only yaw")
                check(after["scroll"] == before["scroll"], "horizontal drag does not scroll page")
            else:
                check(after["yaw"] == before["yaw"] and after["pitch"] == before["pitch"], "vertical touch does not rotate")
                check(after["scroll"] > before["scroll"] + 30, "vertical touch scrolls page")
                check("pointercancel" in names, "native pan cancels pointer capture")
        assert_clean(page, errors)
        page.screenshot(path=str(output / (case_name + ".png")), full_page=False)
        return {"case": case_name, "status": "passed", "evidence": evidence}
    except Exception as error:
        return {"case": case_name, "status": "failed", "error": str(error),
                "errors": errors, "evidence": evidence}
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("1a", "1b", "1c"), default="1a")
    parser.add_argument("--url", default=(ROOT / "index.html").as_uri())
    parser.add_argument("--browser", choices=("chromium", "firefox"), action="append")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    check(urlsplit(args.url).scheme in ("file", "http", "https"), "Use a file:// or HTTP(S) URL")
    stamp = datetime.now(timezone(timedelta(hours=9))).strftime("%Y%m%d_%H%M%S")
    output = args.output or ROOT / ".work" / ("browser-" + args.stage + "-" + stamp)
    output = output.resolve()
    check((ROOT / ".work").resolve() in output.parents, "Browser output must be below repository .work")
    output.mkdir(parents=True, exist_ok=False)
    report = {"stage": args.stage, "url": args.url, "python": sys.executable,
              "browsers": {}, "cases": []}
    with sync_playwright() as playwright:
        for browser_name in args.browser or ("chromium", "firefox"):
            browser = getattr(playwright, browser_name).launch(headless=True)
            report["browsers"][browser_name] = browser.version
            for width in (320, 390, 1280):
                for language in ("ja", "en"):
                    for theme in ("light", "dark"):
                        result = matrix_case(browser, browser_name, args.url, width, language, theme, output, args.stage)
                        report["cases"].append(result)
                        (output / (result["case"] + "-result.json")).write_text(
                            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                        (output / "report.partial.json").write_text(
                            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
                        print(result["case"], result["status"], result.get("error", ""), flush=True)
            report["cases"].extend(precedence_cases(browser, browser_name, args.url))
            if args.stage in ("1b", "1c"):
                report["cases"].append(keyboard_case(browser, browser_name, args.url, output, args.stage))
                if browser_name == "chromium":
                    for width in (320, 390):
                        result = real_touch_case(browser, width, args.url, output)
                        report["cases"].append(result)
                        (output / (result["case"] + "-result.json")).write_text(
                            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                        print(result["case"], result["status"], result.get("error", ""), flush=True)
            if args.stage == "1c" and urlsplit(args.url).scheme == "file":
                with local_http() as smoke_url:
                    for width in (320, 1280):
                        result = http_smoke_case(browser, browser_name, smoke_url, width, output)
                        report["cases"].append(result)
                        (output / (result["case"] + "-result.json")).write_text(
                            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                        print(result["case"], result["status"], result.get("error", ""), flush=True)
            browser.close()
    failed = [item for item in report["cases"] if item["status"] != "passed"]
    report["passed"] = len(report["cases"]) - len(failed)
    report["failed"] = len(failed)
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{report['passed']} passed, {report['failed']} failed; {output}", flush=True)
    for item in failed:
        print(item["case"], item.get("error", ""), flush=True)
    return bool(failed)


if __name__ == "__main__":
    raise SystemExit(main())
