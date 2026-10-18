# Install private browser extensions

You can build bookmarksman for your own browser profiles without listing it in either extension store. The Chrome and Firefox packages use the same synchronization code. Server settings and selected collections are stored separately in each installed browser profile.

## Build the packages

From the repository directory:

```sh
python tools/build-extension.py
```

The build produces:

| Output | Purpose |
| --- | --- |
| `dist/bookmarksman-chrome/` | Load directly in Chrome |
| `dist/bookmarksman-chrome.zip` | Copy to another computer and extract before loading |
| `dist/bookmarksman-firefox/` | Temporary Firefox testing |
| `dist/bookmarksman-firefox.zip` | Firefox package for review/signing |
| `dist/bookmarksman-firefox-unsigned.xpi` | Local Firefox package; requires unsigned-add-on support or signing |

Building packages does not upload anything. A locally built XPI is unsigned; giving a ZIP the `.xpi` extension does not make standard Firefox accept it permanently.

## Chrome: keep a local extension installed

1. Keep `dist/bookmarksman-chrome` in a stable location on your computer.
2. Open `chrome://extensions` in the browser profile that will use bookmarksman.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select that directory.
5. Configure the server and collection in the popup.

The extension remains installed across browser restarts while its directory is available. No store account or public listing is required. Keep the same folder location for updates; removing/re-adding the extension or changing its identity can lose local settings.

For another computer, copy the Chrome ZIP, extract it to a permanent folder, and load that folder. Each browser profile is configured once independently. See [Chrome's local extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Firefox: temporary installation

Temporary and permanent packages are both produced by the same build command. For a temporary installation in standard Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `dist/bookmarksman-firefox/manifest.json`.

This works without signing and remains active until Firefox closes. After rebuilding, click **Reload** in `about:debugging` to use the updated files. To keep the add-on installed across browser restarts, use one of the permanent methods below.

## Firefox: choose a permanent installation method

Firefox's signature requirements depend on the edition. Standard release Firefox requires Mozilla-signed extensions. Building the XPI locally cannot bypass that requirement. Mozilla supports unsigned add-ons in Developer Edition, Nightly, and ESR with signature enforcement disabled; see [Mozilla's signing guidance](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox).

### Local unsigned package

Use this method with a Firefox edition that supports disabling signature enforcement:

1. Open `about:config` and find `xpinstall.signatures.required`.
2. Set it to `false`. This changes signature enforcement for that Firefox installation, so install only packages you trust.
3. Open `about:addons`.
4. Click the gear menu and select **Install Add-on From File…**.
5. Select `dist/bookmarksman-firefox-unsigned.xpi` and accept the installation prompts.
6. Restart Firefox and check that bookmarksman remains installed.

Use **Install Add-on From File**, rather than **Load Temporary Add-on**. The latter removes the extension on restart. Changing the preference in standard release Firefox does not enable permanent unsigned installation.

This workflow is entirely local and needs no signing service or extension-store submission.

### Standard Firefox: unlisted signing

To keep the extension installed in standard release Firefox, submit it for Mozilla signing using the **self-distribution/unlisted** channel. It is not listed publicly in the store, but Mozilla receives the extension package for signing. After signing, you install the downloaded signed XPI yourself.

New signing submissions require a data-transmission declaration. bookmarksman transmits bookmark names, URLs, and folders to the server you choose. For a desktop Firefox signing build, update the `gecko` object in `extension/manifest.firefox.json` to include:

```json
{
  "id": "bookmarksman@local",
  "strict_min_version": "140.0",
  "data_collection_permissions": {
    "required": ["bookmarksInfo"]
  }
}
```

Keep the rest of the manifest, including its HTTP-compatible content security policy. Firefox 140 or newer supplies the built-in consent prompt; supporting earlier versions requires an additional consent experience. See [Mozilla's data-transmission requirements](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

Then:

1. Run `python tools/build-extension.py` again.
2. Sign in to [Mozilla's Add-on Developer Hub](https://addons.mozilla.org/developers/).
3. Submit a new add-on and choose **On your own** / self-distribution, not a public store listing.
4. Upload the generated Firefox ZIP or unsigned XPI, complete the submission requirements, and wait for signing.
5. Download the **signed** XPI. Keep it under a separate name, such as `bookmarksman-firefox-signed.xpi`.
6. In standard Firefox, open `about:addons` → gear menu → **Install Add-on From File…**, then select that signed file.

The local builder does not sign packages or submit them to Mozilla. Follow [Mozilla's self-distribution guide](https://extensionworkshop.com/documentation/publish/self-distribution/) for the current signing flow.

## Updates and saved settings

Keep the Firefox extension ID `bookmarksman@local` unchanged. Before packaging a Firefox update, increase its manifest `version`, rebuild, and install the new XPI over the existing add-on. For standard Firefox, sign every updated package through the same unlisted submission before installing it. Do not uninstall the old add-on as an update step.

For Chrome, rebuild into the same folder and click the reload icon on `chrome://extensions`. Chrome's ZIP is a transport archive; load its extracted directory.

Rebuilding replaces generated unsigned packages and unpacked files. It does not delete separately named signed XPI files in `dist/`. A signed package still contains the code from when it was signed; rebuilding unsigned files does not update it.

Export important local recovery snapshots before changing installation methods. Saved settings remain in the browser profile, not inside the ZIP/XPI, and may be erased by uninstalling or clearing extension data. There is no store-based automatic update feed for these private builds; install updates manually.
