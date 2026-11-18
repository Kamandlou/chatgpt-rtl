# ChatGPT RTL

A Chrome and Firefox extension for right-to-left text in [ChatGPT](https://chatgpt.com/), maintained by Amir Hossein Kamandlou.

## Features

- Detects RTL and LTR text in responses and prompts, including streamed replies.
- Adds direction buttons to messages and the prompt box.
- Keeps code and math left-to-right.
- Supports `Ctrl`/`Cmd` + right Shift for RTL and `Ctrl`/`Cmd` + left Shift for LTR while typing.
- Saves preferences with browser sync storage.
- Optionally uses the bundled Vazirmatn font for ChatGPT text (off by default).

## Install in Chrome

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this repository's folder.
4. Open or reload [ChatGPT](https://chatgpt.com/).
5. Open the extension popup to enable **Vazirmatn font** if desired.

## Install in Firefox

1. Download or clone this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on** and select `manifest.json` from this repository.
4. Open or reload [ChatGPT](https://chatgpt.com/).
5. Open the extension popup to enable **Vazirmatn font** if desired.

Temporary add-ons are removed when Firefox closes. For permanent installation, use the signed add-on from Firefox Add-ons after publication.

## Publish to Firefox Add-ons

Run `npx --yes --package web-ext web-ext build --source-dir . --artifacts-dir dist --overwrite-dest`, then upload the generated ZIP to [addons.mozilla.org/developers](https://addons.mozilla.org/developers/). Firefox requires review and signing before public installation. The extension declares that it does not collect or transmit user data. Keep the Firefox add-on ID in `manifest.json` unchanged for future updates.

## Credits

Maintained by Amir Hossein Kamandlou. Based on the original ChatGPT RTL extension by Roy Damari. The existing copyright notice for Eric Liang is retained in [LICENSE](LICENSE).

## License

The extension is available under the [MIT License](LICENSE). The bundled Vazirmatn font is licensed separately under the [SIL Open Font License 1.1](fonts/OFL.txt).
