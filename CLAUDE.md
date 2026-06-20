# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VoiceMode is a Python package that provides voice interaction capabilities for AI assistants through the Model Context Protocol (MCP). It enables natural voice conversations with Claude Code and other AI coding assistants by integrating speech-to-text (STT) and text-to-speech (TTS) services.

## Key Commands

### Development & Testing
```bash
# Install in development mode with dependencies
make dev-install

# Run all unit tests
make test
# Or directly: uv run pytest tests/ -v --tb=short

# Run specific test
uv run pytest tests/test_voice_mode.py -v

# Clean build artifacts
make clean
```

### Configuration Management
```bash
# Edit configuration file in default editor
voicemode config edit

# Or specify a different editor
voicemode config edit --editor vim
voicemode config edit --editor "code --wait"

# List available configuration keys
voicemode config list

# Get a specific configuration value
voicemode config get VOICEMODE_TTS_VOICE

# Set a configuration value
voicemode config set VOICEMODE_TTS_VOICE nova
```

### Building & Publishing
```bash
# Build Python package
make build-package

# Build development version (auto-versioned)
make build-dev  

# Test package installation
make test-package

# Release workflow (bumps version, tags, pushes)
make release
```

### Documentation
```bash
# Serve docs locally at http://localhost:8000
make docs-serve

# Build documentation site
make docs-build

# Check docs for errors (strict mode)
make docs-check
```

## Architecture Overview

### Core Components

1. **MCP Server (`voice_mode/server.py`)**
   - FastMCP-based server providing voice tools via stdio transport
   - Auto-imports all tools, prompts, and resources
   - Handles FFmpeg availability checks and logging setup

2. **Tool System (`voice_mode/tools/`)**
   - **converse.py**: Primary voice conversation tool with TTS/STT integration
   - **service.py**: Unified service management for Whisper/Kokoro/LiveKit
   - **providers.py**: Provider discovery and registry management
   - **devices.py**: Audio device detection and management
   - Services subdirectory contains install/uninstall tools for Whisper, Kokoro, and LiveKit
   - See [Tool Loading Architecture](docs/reference/tool-loading-architecture.md) for internal details

3. **Provider System (`voice_mode/providers.py`)**
   - Dynamic discovery of OpenAI-compatible TTS/STT endpoints
   - Health checking and failover support
   - Maintains registry of available voice services

4. **Configuration (`voice_mode/config.py`)**
   - Environment-based configuration with sensible defaults
   - Support for voice preference files (project/user level)
   - Audio format configuration (PCM, MP3, WAV, FLAC, AAC, Opus)

5. **Resources (`voice_mode/resources/`)**
   - MCP resources exposed for client access
   - Statistics, configuration, changelog, and version information
   - Whisper model management

6. **Frontend (`voice_mode/frontend/`)**
   - Next.js-based web interface for LiveKit integration
   - Real-time voice conversation UI
   - Built and bundled with the Python package

### Service Architecture

The project supports multiple voice service backends:
- **OpenAI API**: Cloud-based TTS/STT (requires API key)
- **Whisper.cpp**: Local speech-to-text service
- **Kokoro**: Local text-to-speech with multiple voices
- **LiveKit**: Room-based real-time communication

Services can be installed and managed through MCP tools, with automatic service discovery and health checking.

### Key Design Patterns

1. **OpenAI API Compatibility**: All voice services expose OpenAI-compatible endpoints, enabling transparent switching between providers
2. **Dynamic Tool Discovery**: Tools are auto-imported from the tools directory structure
3. **Failover Support**: Automatic fallback between services based on availability
4. **Transport Flexibility**: Supports both local microphone and LiveKit room-based communication
5. **Audio Format Negotiation**: Automatic format validation against provider capabilities

## Development Notes

- The project uses `uv` for package management (not pip directly)
- Python 3.10+ is required
- FFmpeg is required for audio processing
- The project follows a modular architecture with FastMCP patterns
- Service installation tools handle platform-specific setup (launchd on macOS, systemd on Linux)
- Event logging and conversation logging are available for debugging
- WebRTC VAD is used for silence detection when available

## Testing Approach

- Unit tests are in the `tests/` directory
- Manual tests requiring user interaction are in `tests/manual/`
- Use `pytest` for running tests, with fixtures for mocking external services
- Integration tests verify service discovery and provider selection
- The project includes comprehensive test coverage for configuration, providers, and tools

## Logging

VoiceMode maintains comprehensive logs in the `~/.voicemode/` directory:

```
~/.voicemode/
├── logs/
│   ├── conversations/     # JSONL files with daily conversation exchanges
│   │   └── exchanges_YYYY-MM-DD.jsonl
│   ├── events/           # JSONL files with detailed event logs
│   │   └── voicemode_events_YYYY-MM-DD.jsonl
│   └── debug/            # Debug logs when debug mode is enabled
├── audio/                # Saved audio recordings organized by date
│   └── YYYY/MM/         # TTS and STT audio files (.wav format)
├── config/               # User configuration files
│   ├── config.yaml       # Main configuration
│   └── pronunciation.yaml # Custom pronunciation rules
└── services/             # Installed voice services (Whisper, Kokoro, LiveKit)
    ├── whisper/         # Whisper.cpp installation and models
    ├── kokoro/          # Kokoro TTS service
    └── livekit/         # LiveKit server and agents
```

### Log Types

- **Conversation Logs** (`logs/conversations/`): Records of voice exchanges including timestamps, text, and metadata
- **Event Logs** (`logs/events/`): Detailed operational events including TTS/STT operations, errors, and provider selection
- **Audio Recordings** (`audio/`): Saved TTS outputs and STT inputs for debugging and review
- **Debug Logs** (`logs/debug/`): Verbose debugging information when running with `--debug` flag

## Local LiveKit + Android Phone Voice (this worktree)

This worktree is intentionally pinned at **v7.4.2** — the last release with the local-LiveKit
transport (`converse(transport="livekit")`). VoiceMode removed all LiveKit support in 8.0.0, so this
branch (`livekit-frontend`) keeps a working self-hosted path: an Android Chrome phone joins a
self-hosted LiveKit room over WLAN, and the `voicemode-livekit` MCP server's `converse` joins the
same room as the agent participant `voice-mode-bot` (STT/TTS via the local speaches endpoint).

### Hard-won gotchas (don't re-debug these)

- **Mobile Chrome won't play remote audio until `room.startAudio()` runs inside a user gesture.**
  The bot joins *per turn*, so its TTS track always arrives *after* the phone connects — and Chrome
  keeps it muted under the autoplay policy. The fix (`app/page.tsx`) calls `room.startAudio()` in the
  "Voice Input" click handler so playback is armed for whatever tracks show up later. Symptom when
  missing: STT works (local mic needs no unlock) but the phone is silent. A page reload re-locks it.

- **The bot's LiveKit token needs `room_admin` for user-STT speaker attribution.** The agent stamps
  the user's transcription text stream with `sender_identity=<user>`, but the server only honors that
  override for a room admin. Without it, the user's transcript is relabeled `voice-mode-bot` and the
  frontend can't tell who spoke (it then collapses user lines onto the assistant's side, especially
  once the `lk.transcribed_track_id` tag drops off on later turns). Grant is set in
  `voice_mode/tools/converse.py` where the bot's `api.VideoGrants(...)` are built.

- **Transcript speaker classification** (`hooks/useCombinedTranscriptions.ts`) keys off
  `lk.transcribed_track_id` + local-track ownership, *not* participant identity — because identity
  alone is unreliable (see the `room_admin` point above). User mic track = local → right-aligned;
  everything else → assistant → left.

- **The red HAL eye** (`components/ReactiveVisualizer.tsx`) is gated on a remote participant
  (`voice-mode-bot`) being present, so it only burns red while the agent is in the room and sits
  dormant (dark glass) between turns.

- **A "frontend bug" is a stale cached build until proven otherwise.** `next start` serves the
  prebuilt `.next`, and the phone's Chrome caches aggressively — so a UI symptom you can't reproduce
  in a fresh build is almost certainly an old bundle on the phone, not live code. (Cost us a chase
  after "first reply right-aligned, the rest left": the classifier was correct the whole time;
  `lm=T` on every user segment.) Always rebuild + restart + hard-reload the phone before debugging
  a reported UI issue, and confirm against the harness (below) which serves the current bundle.

### Networking: media node_ip vs signaling URL (two addresses, two mechanisms)

The phone needs two reachable addresses, and they are set in completely different ways:

- **Signaling** — `serverUrl` from `app/api/connection-details/route.ts`, read from `LIVEKIT_URL` in
  `frontend/.env.local`. This CAN be a bare hostname (`ws://host:7880`); the phone re-resolves it on
  every connect, so the frontend never needs a rebuild/restart when the machine's IP changes. (Note:
  `route.ts` captures `LIVEKIT_URL` at module load, so *editing* `.env.local` does require a restart —
  but a stable hostname value never changes, so network switches don't.)
- **Media** — the LiveKit server's `--node-ip`, which is written into ICE candidates and therefore
  MUST be a raw IPv4, fixed at server launch. A hostname in `.env.local` does NOT cover this path.

Consequence: a hostname in `.env.local` makes *signaling* network-agnostic, but **media still rides the
raw `node_ip`**. If the phone resolves signaling to a reachable IP while `node_ip` is unreachable from
the phone, you get a connected-but-silent call: WebSocket up, HAL eye shows, no audio.

`node_ip` is no longer pinned in `livekit.yaml`. It is resolved at launch by `../resolve-node-ip.ps1`
(in `C:\devel\misc\voice\`) and passed via `--node-ip` from `start-livekit.bat`. The resolver uses an
ordered `$PreferredPrefixes` list (CONTACT VPN `10.27.80.` first, then home `192.168.178.`): it
searches ALL *Up* adapters so it can select the VPN tunnel, but restricts the no-match fallback to
*physical* adapters so it never advertises a Hyper-V/WSL address. Stale IPs on Disconnected adapters
are filtered out. Override with `$env:LIVEKIT_NODE_IP`. The old DNS/FQDN approach was removed —
corporate DNS returned stale/VPN-side records. **Restart the LiveKit server (not the frontend) after
flipping the VPN** — `node_ip` is fixed at launch.

### Edit → see-it workflow

- **Frontend changes** (`voice_mode/frontend/`) need a rebuild + server restart + phone reload:
  `npm run build`, then restart `next start -H 0.0.0.0 -p 3000`, then reload the page on the phone.
  `next start` serves the prebuilt `.next`, so it will *not* pick up changes without the rebuild.
- **`converse.py` / Python changes** need the **MCP server reconnected** (`/mcp` →
  `voicemode-livekit` → Reconnect) — the editable install only reloads on process restart.
- The controlled chrome-devtools Chrome runs with `prefers-reduced-motion: reduce`, so every CSS
  animation (scan band, LED pulse, text flicker, caret blink) is invisible there but live on the
  phone. Static styling previews fine; motion does not.

### Testing the compose flow without the phone (CDP fake-mic harness)

You can exercise a full KEY XMIT compose turn from a script — no phone, no real mic — which is the
fastest way to confirm transcript classification / alignment against the *current* build.

- **Fake mic:** synthesize a few sentences with ~1s silence gaps (so the agent's VAD segments them)
  via speaches `POST /v1/audio/speech` (`am_michael`), concatenate with `ffmpeg` to a 48 kHz mono
  16-bit WAV. The gaps are what produce multiple transcript segments in one turn.
- **Drive Chrome over CDP:** launch your own Chrome with `--remote-debugging-port`, a throwaway
  `--user-data-dir`, `--use-fake-ui-for-media-stream`, and
  `--use-file-for-fake-audio-capture=<wav>`, then talk CDP (the `.venv-lk` Python has `websockets`).
  Use `Runtime.evaluate` to click buttons by text — `COM LINK` (connect), `KEY XMIT` (start), then
  `RCV` (commit) — and to read each transcript bubble's class (`self-end` = user/right,
  `self-start` = assistant/left). The chrome-devtools MCP can't help here: it manages its own browser
  and can't inject the fake-audio launch flags.
- **Timing rule (important):** the agent (`voice-mode-bot`) is only in the room *during* an active
  `converse()` call, and the wait loop ends a turn the instant the room has no remote participant.
  So make the harness fully autonomous and run it in the background **first**, then immediately call
  `converse(transport="livekit", skip_tts=true)` so the bot is present while the harness connects and
  drives the turn. Kill the harness Chrome afterwards (match its `user-data-dir`) so it doesn't linger
  in the room feeding looped fake audio into the next turn.
- **Limit:** desktop keeps a stable mic track sid, so the harness can't reproduce phone-only track
  churn. It proves the classifier correct and catches regressions; it is not a substitute for a real
  phone repro of environment-specific issues.