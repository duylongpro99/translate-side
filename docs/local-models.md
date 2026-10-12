# Run a local model: Ollama and LM Studio

A model on your own computer translates without sending page text anywhere. Translate Side has a preset for each of
the two common local servers. This page covers install, the one setting each needs so Chrome can reach it, and what
to do when something does not work. The setup guide on first run and **Settings › Providers** walk through the same
steps.

> **What was measured, and what was not.** The project's own quality, cost and speed numbers (the
> [provider matrix](provider-matrix.md)) were taken with Ollama **cloud** and hosted providers, because no local
> model was available to the project's measurements (decision G5). No model of 7–8 B parameters was run. How fast
> and how good a local model is depends on your hardware and the model you choose, so the figures are yours to
> measure: translate a page you know well and judge.

## Before you start

- A computer with enough memory for the model you pick. A small model (about 7–8 B parameters, 4-bit) needs roughly
  5–8 GB free; larger ones need more.
- Translate Side installed, and Chrome 138 or newer.
- Small and reasoning-style models can lose blocks or answer slowly. If blocks fail, use **Retry failed**, or pick a
  larger or non-reasoning model.

## Ollama

1. **Install Ollama** from <https://ollama.com/download> and start it. On macOS and Windows it runs from the menu
   bar or tray; on Linux it runs as a service.
2. **Pull a model.** In a terminal:

   ```bash
   ollama pull qwen3:8b
   ```

   `qwen3:8b` is the preset's suggested model. Any model that Ollama lists under `ollama list` works.
3. **Allow requests from the extension.** Ollama only accepts requests from origins it knows. Chrome sends the
   extension's origin (`chrome-extension://…`), so tell Ollama to allow it with `OLLAMA_ORIGINS`:

   | System | What to do |
   |---|---|
   | macOS | `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"`, then quit Ollama from the menu bar and open it again. |
   | Windows | `setx OLLAMA_ORIGINS "chrome-extension://*"` in PowerShell or Command Prompt, then quit Ollama from the taskbar and start it again. |
   | Linux (systemd) | Add `Environment="OLLAMA_ORIGINS=chrome-extension://*"` to a drop-in for the `ollama` service (`sudo systemctl edit ollama`), then `sudo systemctl restart ollama`. For one session only: `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`. |

   Settings › Providers shows this guide itself, with the command to copy, the first time the server answers "no".
4. **Add the connection.** Open **Settings › Providers › Add a connection** and choose **Ollama (local)**. The base URL
   is filled in as `http://localhost:11434/v1`. Pick your model, press **Test connection**, and allow the access
   Chrome asks for (`http://localhost/*` only).
5. **Make it the model Translate Side uses.** Save the connection, then choose its model for translating (the panel's
   model switcher, or **Routing** in Providers). A site rule (Providers › Routing › Model per site) can send chosen sites to it, and
   "Local only" keeps a site on local models, never falling back to a cloud provider.

## LM Studio

1. **Install LM Studio** from <https://lmstudio.ai> and download a model in its **Discover** tab (a 7–8 B instruct
   model is a sensible start).
2. **Start the server.** In **Developer**, load the model and start the local server (default port 1234).
3. **Turn on CORS.** In **Developer → Server settings**, switch on **Enable CORS**. Without it Chrome blocks the
   request, and Providers says "LM Studio refused requests from the extension".
4. **Add the connection.** In **Settings › Providers › Add a connection** choose **LM Studio (local)**. The base URL is
   `http://localhost:1234/v1`. Press **Test connection**, allow the access Chrome asks for, pick the model it lists,
   and save.

## Other local servers

Any server with an OpenAI-compatible API works through **Custom** in Providers: llama.cpp's `llama-server`, vLLM, or
a gateway on your network. Enter its base URL (ending in `/v1`) and choose **No key** if it has none.

Plain `http://` is accepted only for this computer (`localhost`, `127.0.0.1`, `[::1]`) and for your local network
(`10.x`, `172.16–31.x`, `192.168.x` and `*.local` names). A server on your network shows "Unencrypted: only use this
on a network you trust." For anything else the address must be `https://`. See the
[privacy policy](privacy.md) for why.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| "Nothing answers at localhost:11434" | Ollama is not running. Start it, or run `ollama serve`, then test again. |
| "…refused requests from the extension" or a CORS error | Set `OLLAMA_ORIGINS` (above) and restart Ollama; or turn on **Enable CORS** in LM Studio. Test connection tries again by itself. |
| The model is not in the list | Pull or download it first (`ollama pull <name>`), then press **Test connection** again to refresh the list. |
| "model not found" | The model name is spelled differently from `ollama list`; choose it from the list rather than typing it. |
| The first block takes a long time | The model is loading into memory. Later blocks are faster. A smaller model starts sooner. |
| Blocks fail or come back empty | A reasoning-style model may use its output budget on thinking. Choose a non-reasoning instruct model, or use **Retry failed**. |
| "No access to localhost" in the panel | The access Chrome asked for was declined. Press **Grant access** in the panel, or **Test connection** in Providers, and allow it. |
| Text still goes to the internet | Check the routing: a site rule or a fallback may point at a cloud provider. Turn on **Local only** for the site (Providers › Routing › Model per site), or remove the fallback. |

<!--
Reviewer-only: where each statement comes from (paths relative to the repository root).

- Presets, base URLs, the suggested model: src/shared/presets.ts:104-137 (ollama, ollama-cloud, lmstudio).
- OLLAMA_ORIGINS value and the per-OS commands: src/shared/connect.ts:405 (OLLAMA_ORIGINS), :410-442 (corsGuide: macOS
  launchctl, Windows setx, Linux systemd drop-in and `ollama serve`); the guide text: src/locales/en.yml
  options.connect.guide* and corsLmStudio, notRunningLmStudio.
- The Linux `systemctl edit` route is the standard way to write the same drop-in the guide writes with tee; the
  console guide's own command is the reference.
- Messages quoted in Troubleshooting: src/locales/en.yml options.connect.* (notRunning*, cors*), panel.state.noAccess
  (the access message), options.providers.* ("Local only" is routing's localOnly: src/shared/providers.ts:842).
- Plain-HTTP rule: src/llm/endpoint.ts:31, src/llm/errors.ts:18, src/shared/settings.ts:225.
- Decision G5 (no local model measured): docs/provider-matrix.md "Scope" and item 2 of its open items.
- Access request for localhost: src/entrypoints/options/Providers.tsx:818 (Test), src/shared/settings.ts:206
  (originPattern gives http://localhost/*).
- Memory sizes are general guidance for 4-bit 7–8 B models, not a measurement of this project.
-->
