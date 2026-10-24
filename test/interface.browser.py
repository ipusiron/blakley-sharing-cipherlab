"""Local browser gates; no install, server, or CI browser dependency is required.

Run with an existing Python environment that contains Playwright:
    python test/interface.browser.py --stage 1a
    python test/interface.browser.py --stage 1a --url http://127.0.0.1:8000/
Results and viewport screenshots are written below .work.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
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
    initial_candidate = page.locator("#candidate-value").inner_text()
    click_visible(page, "candidate-next")
    check(page.locator("#candidate-value").inner_text() != initial_candidate, "candidate advances")
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
    choose_shares(page, set())
    check(not selected_shares(page), "zero selected shares allowed")
    check(not point_data(page, "main-grid"), "no selected line points")
    choose_shares(page, {0})
    show_details(page, "dealer")
    original_distribution = page.locator("#distribution-table").inner_text()
    show_details(page, "edit-controls")
    before_shift = point_data(page, "main-grid")
    click_visible(page, "shift-plus")
    check(point_data(page, "main-grid") != before_shift, "shift changes drawn copy")
    click_visible(page, "shift-minus")
    check(point_data(page, "main-grid") == before_shift, "opposite shift restores copy")
    check(page.locator("#distribution-table").inner_text() == original_distribution, "editing preserves distributed values")
    check(not page.locator("#real-story").is_visible(), "edited copies hide real diagram")
    check(page.locator("#edited-real-note").is_visible(), "edited real explanation")
    click_visible(page, "reset-edit")
    check(page.locator("#real-story").is_visible(), "reset restores real diagram")
    for _ in range(default["A"][0][1]):
        click_visible(page, "direction-minus")
    warning = page.locator("#edit-warning").inner_text()
    expected_warning = "この1本で s が決まる" if language == "ja" else "This one share determines s"
    check(expected_warning in warning, "vertical line warning")
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
    click_visible(page, "k3-start")
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
    check(page.locator("#slice-grid .grid-overlap").count() == 0, "empty slice has no partial-overlap emphasis")
    check(page.locator("#slice-grid .grid-secret").count() == 0, "empty slice has no secret mark")
    click_visible(page, "slice-7")
    feature_layout(page, width, "k3-three-planes", layouts, ("scene", "slices", "slice-grid"))
    click_visible(page, "slice-7")
    check("(2,9)" in page.locator("#slice-result").inner_text().replace(" ", ""), "three-plane slice intersection")


def test_matrices(page, width, layouts, vectors):
    for dimension in (4, 5):
        default = vectors["default_k" + str(dimension)]
        click_visible(page, "k" + str(dimension))
        choose_shares(page, set(range(dimension)))
        check(page.locator("#matrix-view").is_visible(), "matrix view")
        check(not page.locator("#view-3d").is_visible(), "no 3D for larger k")
        check(not page.locator("#k2-view").is_visible(), "no k2 figure for larger k")
        for index, step in enumerate(default["steps123"]):
            check(matrix_values(page) == step["m"], ("matrix", dimension, index, matrix_values(page)))
            if index != len(default["steps123"]) - 1:
                click_visible(page, "matrix-next")
        check(page.locator("#matrix-next").is_disabled(), "final matrix next disabled")
        click_visible(page, "matrix-prev")
        check(matrix_values(page) == default["steps123"][-2]["m"], "previous matrix")
        feature_layout(page, width, "k" + str(dimension) + "-matrix", layouts, ("matrix-table",))
        choose_shares(page, set(range(dimension - 1)))
        check(not page.locator("#candidate-controls").is_visible(), "larger k uses candidate table only")
        check(page.locator("#matrix-candidates tbody tr").count() == default["p"], "one row per secret candidate")
        feature_layout(page, width, "k" + str(dimension) + "-candidates", layouts, ("matrix-table",))


def test_dealer(page, width, layouts, vectors, language):
    click_visible(page, "k2-start")
    show_details(page, "dealer")
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
        if stage == "1b":
            test_stage1b(page, width, layouts, language)
        saved = test_preferences_interaction(page, language, theme)
        assert_clean(page, errors)
        return {"case": case_name, "status": "passed", "layouts": layouts, "saved": saved}
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


def keyboard_case(browser, browser_name, url, output):
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
        assert_clean(page, errors)
        page.screenshot(path=str(output / (browser_name + "-keyboard-k3.png")), full_page=False)
        return {"case": browser_name + "-keyboard-routes", "status": "passed",
                "routes": {"one-line-13-columns": first, "k3-start": second, "third-share": third}}
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
    parser.add_argument("--stage", choices=("1a", "1b"), default="1a")
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
            if args.stage == "1b":
                report["cases"].append(keyboard_case(browser, browser_name, args.url, output))
                if browser_name == "chromium":
                    for width in (320, 390):
                        result = real_touch_case(browser, width, args.url, output)
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
