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


def new_context(browser, browser_name, width, language, theme):
    options = {
        "viewport": {"width": width, "height": 900},
        "locale": "ja-JP" if language == "ja" else "en-US",
        "color_scheme": theme, "reduced_motion": "reduce", "has_touch": width < 720,
    }
    if browser_name == "chromium":
        options["is_mobile"] = width < 720
    return browser.new_context(**options)


def matrix_case(browser, browser_name, url, width, language, theme, output):
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("1a",), default="1a")
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
                        result = matrix_case(browser, browser_name, args.url, width, language, theme, output)
                        report["cases"].append(result)
                        print(result["case"], result["status"], flush=True)
            report["cases"].extend(precedence_cases(browser, browser_name, args.url))
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
