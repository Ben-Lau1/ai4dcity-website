# AI4DCity LCCViewer Mini Program Wrapper

This mini program is a thin WebView shell for the LCCViewer H5 page.

## Current Target

```text
https://www.ai4dcity.com/lccviewer/index.html
```

## Development

Open this directory in WeChat DevTools:

```powershell
$devtools = "D:\<WeChat DevTools install dir>\cli.bat"
& $devtools open --project "D:\Agents\website_agent\ai4city-website\ai4dcity_react\ai4city-lccviewer-miniprogram"
```

The project uses `touristappid` so it can be imported before the real AppID is available.

## Release Requirements

Before real-device preview and release:

1. Replace `project.config.json` `appid` with the registered mini program AppID.
2. Confirm the H5 page is available over HTTPS: `https://www.ai4dcity.com/lccviewer/index.html`.
3. Add `www.ai4dcity.com` to the mini program web-view business domain in the WeChat public platform.
4. Update `app.js` `viewerUrl` to the HTTPS URL.
