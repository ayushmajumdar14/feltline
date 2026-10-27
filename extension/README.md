# Feltline Chrome extension

Lets anyone use a live Poker Now private table from [feltline-ten.vercel.app](https://feltline-ten.vercel.app) without the terminal. The extension reads the table socket and clicks Fold / Check / Call / Bet / Raise when you Take a suggestion on the website.

## Install (once)

Easiest: download the zip from https://feltline-ten.vercel.app/install (extension only, not GitHub).

Or load this folder unpacked:

1. Chrome → `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → choose this `extension` folder
4. Pin Feltline
5. After Reload, refresh the Poker Now tab and the Feltline coach tab (or Chrome throws “Extension context invalidated”)

## Use

1. Sign in at https://feltline-ten.vercel.app and add the Poker Now table link
2. Open that table in Chrome (this profile)
3. Open the table’s coach page on Feltline
4. When it’s your seat, Take / Override / Ignore on the website — the extension clicks on Poker Now

Auto-play still requires the Settings consent checklist, then Auto-play on that table.

Private tables only. Suggested-action wording does not make a bot legal on rooms that forbid assistants.
