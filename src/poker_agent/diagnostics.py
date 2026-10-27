"""Read-only PokerNow interface inspection. Never submits actions or collects cookies."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

SENSITIVE = re.compile(r'(token|secret|password|cookie|authorization|session|email)', re.I)

async def inspect_page(page, output_dir: str):
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    if not re.fullmatch(r'https://(www\.)?pokernow\.(club|com)/.*', page.url):
        raise ValueError('Inspection is restricted to PokerNow HTTPS pages')
    controls = await page.locator('button, input, textarea, [role="button"], [contenteditable="true"]').evaluate_all('''els => els.map((el, i) => ({
      index:i, tag:el.tagName.toLowerCase(), role:el.getAttribute('role'),
      text:(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0,100),
      placeholder:el.getAttribute('placeholder'), type:el.getAttribute('type'),
      title:el.getAttribute('title'), disabled:el.hasAttribute('disabled'),
      visible:!!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    }))''')
    for c in controls:
        for key in list(c):
            if SENSITIVE.search(key) or (isinstance(c[key], str) and SENSITIVE.search(c[key])):
                c[key] = '[redacted]'
    snapshot = {'timestamp':datetime.now(timezone.utc).isoformat(),
                'origin':page.url.split('/')[2], 'title':await page.title(),
                'controls':controls}
    (out/'controls.json').write_text(json.dumps(snapshot, indent=2))
    await page.screenshot(path=str(out/'table.png'), full_page=False)
    return snapshot


def propose_selectors(snapshot):
    """Human-readable suggestions only, never automatically trusted for execution."""
    terms={'fold_button':r'\bfold\b','check_button':r'\bcheck\b',
           'call_button':r'\bcall\b','raise_button':r'\b(raise|bet)\b',
           'leave_seat_button':r'\b(leave|stand up|sit out)\b',
           'chat_send_button':r'\bsend\b'}
    result={}
    for name, pattern in terms.items():
        matches=[c for c in snapshot['controls'] if c['visible'] and
                 re.search(pattern, ' '.join(str(c.get(k) or '') for k in ('text','title','placeholder')),re.I)]
        result[name]=[{'index':c['index'],'tag':c['tag'],'text':c['text']} for c in matches]
    return result
