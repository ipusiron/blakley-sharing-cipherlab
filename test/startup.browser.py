"""Readable startup under delayed, missing, or disabled JavaScript."""
import argparse, asyncio, base64, functools, hashlib, json, threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
FILES=['index.html','style.css','theme-init.js','app.js','messages.js','gf-core.js','pitfalls.js',
       'test/vectors.json','test/startup.browser.py']
V=json.loads((ROOT/'test/vectors.json').read_text(encoding='utf-8'))
def check(value, reason):
    if not value: raise AssertionError(reason)

PROBE=r"""(() => {
window.startupEvidence={states:[],csp:[]};let previous='';
document.addEventListener('securitypolicyviolation',e=>startupEvidence.csp.push(e.violatedDirective));
const sample=()=>{const x={at:performance.now(),ready:document.documentElement.dataset.appReady,
 heading:!!document.querySelector('#threshold-title')?.textContent.trim(),
 intro:document.querySelectorAll('#intro-grid .grid-mark').length,
 main:document.querySelectorAll('#main-grid .grid-mark').length,
 noteHidden:document.querySelector('#startup-note')?.hidden,
 toolsDisabled:document.querySelector('#startup-tools')?.disabled,
 controlsDisabled:document.querySelector('#startup-controls')?.disabled};
 const key=JSON.stringify(Object.values(x).slice(1));if(key!==previous){startupEvidence.states.push(x);previous=key;}};
new MutationObserver(sample).observe(document,{subtree:true,childList:true,attributes:true});
})();"""
SNAP=r"""() => ({
 at:performance.now(),readyState:document.readyState,appReady:document.documentElement.dataset.appReady,
 lang:document.documentElement.lang,theme:document.documentElement.dataset.theme||null,
 heading:document.querySelector('#threshold-title')?.textContent||'',
 note:document.querySelector('#startup-note')?.innerText||'',noteHidden:document.querySelector('#startup-note')?.hidden,
 toolsDisabled:document.querySelector('#startup-tools')?.disabled,
 controlsDisabled:document.querySelector('#startup-controls')?.disabled,
 effectiveDisabled:[...document.querySelectorAll('#startup-tools button,#startup-controls button,#startup-controls input,#startup-controls select')].every(x=>x.matches(':disabled')),
 unnamedButtons:[...document.querySelectorAll('button')].filter(x=>x.getClientRects().length&&!x.closest('[hidden]')&&!x.textContent.trim()&&!x.getAttribute('aria-label')).map(x=>x.id),
 introMarks:document.querySelectorAll('#intro-grid .grid-mark').length,
 mainMarks:document.querySelectorAll('#main-grid .grid-mark').length,
 placeholders:[...document.querySelectorAll('#intro-grid .graph-loading')].map(x=>x.textContent),
 viewBox:document.querySelector('#intro-grid')?.getAttribute('viewBox')||null,
 introPoints:document.querySelector('#intro-grid')?.dataset.points||null,
 focus:document.activeElement===document.querySelector('#math-primer>summary')?'math-summary':document.activeElement?.id||document.activeElement?.tagName,
 client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
 paint:performance.getEntriesByType('paint').map(x=>({name:x.name,at:x.startTime})),
 evidence:window.startupEvidence||{states:[],csp:[]}})"""
CASES=[
 dict(name='pending-ja-chromium',browser='chromium',width=320,language='ja',theme='light',hold_app=True),
 dict(name='pending-en-firefox',browser='firefox',width=1280,language='en',theme='dark',hold_app=True),
 dict(name='css-then-app-chromium',browser='chromium',width=320,language='en',theme='dark',hold_css=True,hold_app=True,focus_reload=True),
 dict(name='css-then-app-firefox',browser='firefox',width=1280,language='ja',theme='light',hold_css=True,hold_app=True),
 dict(name='missing-gf-core',browser='chromium',width=320,language='ja',theme='light',fail='gf-core.js',missing='BlakleyGF'),
 dict(name='missing-pitfalls',browser='firefox',width=320,language='en',theme='dark',fail='pitfalls.js',missing='BlakleyPitfalls'),
 dict(name='missing-messages',browser='chromium',width=1280,language='en',theme='dark',fail='messages.js',missing='BlakleyMessages'),
 dict(name='missing-app',browser='firefox',width=1280,language='ja',theme='light',fail='app.js'),
 dict(name='javascript-disabled-ja',browser='chromium',width=320,language='ja',theme='light',disabled=True),
 dict(name='javascript-disabled-en',browser='firefox',width=320,language='en',theme='dark',disabled=True),
 dict(name='storage-denied',browser='chromium',width=320,language='en',locale='ja',theme='dark',storage_denied=True),
 dict(name='query-over-saved',browser='firefox',width=1280,language='ja',locale='en',theme='dark',saved={'language':'en','theme':'light'},hold_app=True,focus_reload=True),
 dict(name='preference-separation-chromium',browser='chromium',width=320,language='ja',theme='dark',separate_preferences=True),
 dict(name='preference-separation-firefox',browser='firefox',width=1280,language='en',theme='light',separate_preferences=True)]
PILOT={'pending-ja-chromium','css-then-app-chromium','missing-app','javascript-disabled-en','storage-denied'}

async def pending_contract(page,s):
    check(s['appReady']!='true','unfinished app must not signal readiness')
    check(s['toolsDisabled'] and s['controlsDisabled'] and s['effectiveDisabled'],'unfinished controls remain effectively disabled')
    check(not s['noteHidden'] and '\u6e96\u5099' in s['note'] and 'Loading diagrams' in s['note'],'short bilingual preparation notice remains readable')
    check(s['heading'].strip() and not s['unnamedButtons'],'static heading and button labels remain readable')
    check(s['introMarks']==0 and len(s['placeholders'])==2,'initial empty diagram has two preparation labels')
    check(any('Preparing' in x for x in s['placeholders']) and any('\u6e96\u5099' in x for x in s['placeholders']),'preparation labels contain both languages')
    check(len(s['viewBox'].split())==4,'initial diagram reserves viewBox')
    await page.locator('#startup-help>summary').click()
    help_text=await page.locator('#startup-help').inner_text()
    check('JavaScript' in help_text and '\u8aad' in help_text,'expanded startup help explains the unavailable state')
    check(await page.locator('#startup-reload').is_visible(),'native reload link is visible')
    check(await page.locator('#startup-reload').evaluate('el=>el.href===location.href'),'reload preserves current URL/query')
    check(await page.locator('.primer-equations tbody tr').count()==4,'four fixed equations remain readable')
    await page.locator('#startup-help>summary').click()

async def child_disabled(page):
    await page.locator('#pick-0').click()
    check(await page.locator('#shift-plus').is_disabled(),'zero shares keeps edit disabled')
    await page.locator('#pick-0').click()
    check(not await page.locator('#shift-plus').is_disabled(),'selecting a share enables editing')


PREFERENCE_SPY=r"""(() => {
window.preferenceWrites=[];
const original=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){
 if(this===window.localStorage)window.preferenceWrites.push([String(key),String(value)]);
 return original.call(this,key,value);
};
})();"""
PREFERENCE_STATE=r"""() => ({
 theme:document.documentElement.dataset.theme,language:document.documentElement.lang,
 savedTheme:localStorage.getItem('blakley-sharing-cipherlab.theme'),
 savedLanguage:localStorage.getItem('blakley-sharing-cipherlab.language'),writes:window.preferenceWrites
})"""

async def preference_separation(page,spec):
    language=spec['language'];other_language='en' if language=='ja' else 'ja'
    theme=spec['theme'];other_theme='light' if theme=='dark' else 'dark'
    language_key='blakley-sharing-cipherlab.language';theme_key='blakley-sharing-cipherlab.theme'
    states=[]
    async def sample(stage):
        value=await page.evaluate(PREFERENCE_STATE);value['stage']=stage;states.append(value);return value
    initial=await sample('initial')
    check(initial['writes']==[] and initial['savedTheme'] is None and initial['savedLanguage'] is None,
          'initial rendering must not persist an implicit preference')
    await page.locator('#language').click()
    changed=await sample('language-click')
    check(changed['language']==other_language and changed['savedLanguage']==other_language,'language button saves its actual choice')
    check(changed['theme']==theme and changed['savedTheme'] is None,'language action must not pin the implicit OS theme')
    check(changed['writes']==[[language_key,other_language]],'language action writes only the language key')
    await page.emulate_media(color_scheme=other_theme)
    await page.reload(wait_until='load')
    await page.wait_for_function("() => document.documentElement.dataset.appReady==='true'")
    reloaded=await sample('new-os-reload')
    check(reloaded['theme']==other_theme and reloaded['savedTheme'] is None,'unsaved theme follows a changed OS after reload')
    check(reloaded['language']==language and reloaded['savedLanguage']==other_language,'query priority does not overwrite saved language')
    check(reloaded['writes']==[],'reload has no persistence side effect')
    await page.locator('#theme').click()
    changed=await sample('theme-click')
    check(changed['theme']==theme and changed['savedTheme']==theme,'theme button saves its actual choice')
    check(changed['language']==language and changed['savedLanguage']==other_language,'theme action preserves an existing different saved language')
    check(changed['writes']==[[theme_key,theme]],'theme action writes only the theme key')
    await page.reload(wait_until='load')
    await page.wait_for_function("() => document.documentElement.dataset.appReady==='true'")
    saved=await sample('explicit-theme-reload')
    check(saved['theme']==theme and saved['savedTheme']==theme,'explicit saved theme overrides the opposite OS')
    check(saved['savedLanguage']==other_language and saved['writes']==[],'reload retains both keys without rewriting them')
    await page.locator('#language').click()
    changed=await sample('language-with-explicit-theme')
    check(changed['language']==other_language and changed['savedTheme']==theme,'language action retains the explicit saved theme')
    check(changed['writes']==[[language_key,other_language]],'language action never rewrites the theme key')
    return states

async def run_case(pw,url,spec,out):
    browser=await getattr(pw,spec['browser']).launch()
    context=await browser.new_context(viewport={'width':spec['width'],'height':900},locale=spec.get('locale',spec['language']),
        color_scheme=spec['theme'],java_script_enabled=not spec.get('disabled',False),reduced_motion='reduce',device_scale_factor=1)
    page=await context.new_page();errors=[];requests=[];console=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('requestfailed',lambda r:requests.append({'url':r.url,'failure':r.failure}))
    page.on('console',lambda m:console.append(m.text) if m.type=='error' else None)
    await page.add_init_script(PROBE)
    if spec.get('separate_preferences'): await page.add_init_script(PREFERENCE_SPY)
    if spec.get('storage_denied'):
        await page.add_init_script("Storage.prototype.getItem=function(){throw new DOMException('test blocked','SecurityError')};Storage.prototype.setItem=function(){throw new DOMException('test blocked','SecurityError')};")
    if spec.get('saved'):
        await page.add_init_script('for(const [key,value] of Object.entries('+json.dumps(spec['saved'])+'))localStorage.setItem("blakley-sharing-cipherlab."+key,value);')
    app_gate,css_gate,css_requested=asyncio.Event(),asyncio.Event(),asyncio.Event()
    if spec.get('hold_app'):
        async def hold_app(route): await app_gate.wait();await route.continue_()
        await page.route('**/app.js',hold_app)
    if spec.get('hold_css'):
        async def hold_css(route):
            css_requested.set();await css_gate.wait();await route.continue_()
        await page.route('**/style.css',hold_css)
    if spec.get('fail'):
        async def fail(route): await route.abort('failed')
        await page.route('**/'+spec['fail'],fail)
    result={'case':spec['name'],'spec':spec,'states':[],'browser_version':browser.version}
    cdp=await context.new_cdp_session(page) if spec['browser']=='chromium' else None
    async def snap(stage):
        s=await page.evaluate(SNAP);s['stage']=stage
        if stage!='css-pending':
            path=out/(spec['name']+'-'+stage+'.png')
            if cdp:
                captured=await asyncio.wait_for(cdp.send('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False}),10)
                path.write_bytes(base64.b64decode(captured['data']));s['screenshot']=str(path)
            elif stage!='app-pending':
                await page.screenshot(path=str(path));s['screenshot']=str(path)
        result['states'].append(s);return s
    try:
        await page.goto(url+'?lang='+spec['language'],wait_until='commit')
        if spec.get('hold_css'):
            await asyncio.wait_for(css_requested.wait(),10)
            await snap('css-pending');css_gate.set()
            await page.wait_for_function('() => document.styleSheets.length>0')
        await page.wait_for_function("() => !!document.querySelector('#intro-grid')")
        if spec.get('hold_app'):
            await page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
            pending=await snap('app-pending');await pending_contract(page,pending)
            check(pending['theme']==spec.get('saved',{}).get('theme',spec['theme']),
                  'synchronous theme is applied while the application is still pending')
            await page.locator('#math-primer>summary').focus()
            await page.keyboard.press('Enter')
            check(await page.locator('#math-primer').evaluate('el=>el.open'),'native details opens while app is pending')
            await page.keyboard.press('Space')
            check(not await page.locator('#math-primer').evaluate('el=>el.open'),'native details closes while app is pending')
            if spec.get('focus_reload'):
                await page.locator('#startup-help>summary').click()
                await page.locator('#startup-reload').focus()
            app_gate.set()
        await page.wait_for_load_state('load')
        if spec.get('fail') or spec.get('disabled'):
            await pending_contract(page,await snap('unavailable'))
            if spec.get('disabled'):
                await page.locator('#startup-help>summary').click()
                original_url=page.url
                async with context.expect_page() as new_page:
                    await page.locator('#startup-reload').click()
                reopened=await new_page.value
                await reopened.wait_for_load_state('load')
                check(reopened.url==original_url and page.url==original_url,'reopen preserves the URL in both tabs')
                check(await reopened.evaluate('() => window.opener===null'),'reopened tab has no window.opener')
                await pending_contract(reopened,await reopened.evaluate(SNAP))
                await reopened.close()
                check(await page.locator('#startup-help').evaluate('el=>el.open'),'original startup help remains open')
                await page.locator('#startup-help>summary').click()
                await pending_contract(page,await snap('native-reopen'))
        else:
            await page.wait_for_function("() => document.documentElement.dataset.appReady==='true'")
            await page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
            s=await snap('ready')
            scripts=await page.locator('head script[src]').evaluate_all('els=>els.map(el=>({src:el.getAttribute("src"),defer:el.defer,async:el.async}))')
            check([x['src'] for x in scripts]==['theme-init.js','gf-core.js','pitfalls.js','messages.js','app.js'],
                  'theme initializer precedes the four application dependencies')
            check(not scripts[0]['defer'] and not scripts[0]['async'] and all(x['defer'] and not x['async'] for x in scripts[1:]),
                  'theme script is synchronous and the four application scripts stay deferred')
            check(not s['toolsDisabled'] and not s['controlsDisabled'] and s['noteHidden'],'successful render releases startup guards')
            check(s['introMarks']==13 and s['mainMarks']==13 and not s['placeholders'],'first ready view contains both initial diagrams')
            check(json.loads(s['introPoints'])==V['default_k2']['lines'][0],'initial point set matches independent vector')
            check(s['lang']==spec['language'] and s['theme']==spec.get('saved',{}).get('theme',spec['theme']),'ready preferences retain priority')
            check(s['focus']==('math-summary' if spec.get('hold_app') and not spec.get('focus_reload') else 'BODY'),'startup does not steal focus')
            check(s['scroll']<=s['client']+1 and not s['unnamedButtons'],'ready view has no overflow or unnamed buttons')
            states=[x for x in s['evidence']['states'] if x['ready']=='true']
            check(states and all(x['heading'] and x['intro']==13 and x['main']==13 and x['noteHidden'] and not x['toolsDisabled'] and not x['controlsDisabled'] for x in states),'ready marker never precedes complete rendering')
            check(not await page.evaluate('() => !!document.activeElement.closest("[hidden]")'),'focus never remains in the hidden startup note')
            await child_disabled(page)
            if spec.get('separate_preferences'):
                result['preference_separation']=await preference_separation(page,spec)
            if spec.get('storage_denied'):
                await page.locator('#theme').click();await page.locator('#language').click()
                check(await page.locator('html').get_attribute('lang')=='ja','language works without preference storage')
                check(await page.locator('html').get_attribute('data-theme')=='light','theme works without preference storage')
        evidence=await page.evaluate('() => window.startupEvidence||{csp:[]}')
        check(not evidence['csp'],'no CSP violation')
        if spec.get('fail'):
            check(requests and all(x['url'].split('?')[0].endswith('/'+spec['fail']) for x in requests),'only injected dependency fails')
            check(all(spec.get('missing','NO_EXPECTED_SCRIPT_ERROR') in e for e in errors),'only injected missing global may raise an error')
        else: check(not errors and not requests and not console,'no unexpected startup error')
        result['status']='passed'
    except Exception as error: result.update(status='failed',error=str(error))
    finally:
        app_gate.set();css_gate.set();result.update(page_errors=errors,request_failures=requests,console_errors=console)
        await context.close();await browser.close()
    (out/(spec['name']+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(spec['name'],result['status'],result.get('error',''),flush=True);return result

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*_): pass

async def main(args):
    out=(args.output or ROOT/'.work'/('qa-startup-'+datetime.now().strftime('%Y%m%d_%H%M%S'))).resolve()
    check(out.is_relative_to(ROOT.resolve()),'evidence must stay inside target repo');out.mkdir(parents=True,exist_ok=False)
    source=lambda:{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}
    before=source();report={'started_at':datetime.now().isoformat(timespec='seconds'),'source_before':before,'cases':[]}
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        async with async_playwright() as pw:
            for spec in CASES:
                if not args.pilot or spec['name'] in PILOT:
                    report['cases'].append(await run_case(pw,'http://127.0.0.1:'+str(server.server_port)+'/',spec,out))
                    (out/'report.partial.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    finally: server.shutdown()
    report['source_after']=source();report['source_stable']=before==report['source_after']
    report['passed']=sum(x['status']=='passed' for x in report['cases']);report['failed']=len(report['cases'])-report['passed']
    report['completed_at']=datetime.now().isoformat(timespec='seconds')
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(report['passed'],'passed',report['failed'],'failed',out/'report.json',flush=True)
    return bool(report['failed'] or not report['source_stable'])

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path)
    parser.add_argument('--pilot',action='store_true',help='Run five representative startup cases.')
    raise SystemExit(asyncio.run(main(parser.parse_args())))

